import * as path from 'path'
import * as exec from 'actions-exec-listener'
import * as core from '@actions/core'
import * as cache from '@actions/cache'
import { ExecOptions } from '@actions/exec/lib/interfaces'
import { promises as fs } from 'fs'
import { Layer, LayerMap, loadLayerMap, getManifestHash } from './Tar'
import format from 'string-format'
import PromisePool from 'native-promise-pool'

class LayerCache {
  ids: string[] = []
  unformattedSaveKey: string = ''
  restoredRootKey: string = ''
  imagesDir: string = path.join(__dirname, '..', '.adlc')
  enabledParallel = true
  concurrency: number = 4

  static ERROR_CACHE_ALREAD_EXISTS_STR = `Unable to reserve cache with key`
  static ERROR_LAYER_CACHE_NOT_FOUND_STR = `Layer cache not found`

  constructor(ids: string[]) {
    this.ids = ids
  }

  async exec(command: string, args?: string[], options?: ExecOptions) {
    const result = await exec.exec(command, args, options)

    return result
  }

  async store(key: string) {
    this.unformattedSaveKey = key

    await this.saveImageAsUnpacked()

    const layerMap = await loadLayerMap(this.getUnpackedTarDir())
    if (this.enabledParallel) {
      await this.separateAllLayerCaches(layerMap)

      core.info(`Listing .`)
      await this.exec(`sh -c`, [`ls -lR`], { cwd: this.getUnpackedTarDir() })
    }

    if (await this.storeRoot() === undefined) {
      core.info(`cache key already exists, aborting.`)
      return false
    }

    if (this.enabledParallel) {
      const diffidTarFiles = layerMap.map((layer) => path.join(layer.id, `layer.tar`))
      await this.storeLayers(diffidTarFiles)
    }
    return true
  }

  private async saveImageAsUnpacked() {
    await fs.mkdir(this.getUnpackedTarDir(), { recursive: true })
    core.info(`Saving ${JSON.stringify(this.ids)}`)
    await this.exec(`sh -c`, [`docker save '${(await this.makeRepotagsDockerSaveArgReady(this.ids)).join(`' '`)}' | tar xf - -C .`], { cwd: this.getUnpackedTarDir() })
    core.info(`Listing .`)
    await this.exec(`sh -c`, [`ls -lR`], { cwd: this.getUnpackedTarDir() })
    core.info(`Manifests`)
    await this.exec(`sh -c`, [`awk '{print FILENAME "\\n" $0}' *.json`], { cwd: this.getUnpackedTarDir() })
  }

  private async makeRepotagsDockerSaveArgReady(repotags: string[]): Promise<string[]> {
    const getMiddleIdsWithRepotag = async (id: string): Promise<string[]> => {
      return [id, ...(await this.getAllImageIdsFrom(id))]
    }
    return (await Promise.all(repotags.map(getMiddleIdsWithRepotag))).flat()
  }

  private async getAllImageIdsFrom(repotag: string): Promise<string[]> {
    const { stdoutStr: rawHistoryIds } = await this.exec(`docker history -q`, [repotag], { silent: true, listeners: { stderr: console.warn }})
    const historyIds = rawHistoryIds.split(`\n`).filter(id => id !== `<missing>` && id !== ``)
    return historyIds
  }

  private async storeRoot() {
    const rootKey = await this.generateRootSaveKey()
    const paths = [
      this.getUnpackedTarDir(),
    ]
    core.info(`Start storing root cache, key: ${rootKey}, dir: ${paths}`)
    const cacheId = await LayerCache.dismissError(cache.saveCache(paths, rootKey), LayerCache.ERROR_CACHE_ALREAD_EXISTS_STR, -1)
    core.info(`Stored root cache, key: ${rootKey}, id: ${cacheId}`)
    return cacheId !== -1 ? cacheId : undefined
  }

  private async separateAllLayerCaches(layerMap: LayerMap) {
    const fromDir = this.getUnpackedTarDir()
    const toDir = this.getLayerCachesDir()

    const moveLayer = async (layer: Layer) => {
      const fromPaths = layer.paths.map((layerPath) => path.join(fromDir, layerPath))
      const from = await fs.realpath(fromPaths[0])
      const to = path.join(toDir, layer.id, `layer.tar`)
      core.debug(`Moving layer tar from ${from} to ${to}`)

      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.rename(from, to)

      const deleteDuplicateLayer = async (layerPath: string) => {
        core.debug(`Deleting duplicate layer tar from ${layerPath}`)
        return fs.unlink(layerPath)
      }
      return Promise.all(fromPaths.slice(1).map(deleteDuplicateLayer))
    }

    await Promise.all(layerMap.map(moveLayer))
  }

  private async joinAllLayerCaches(layerMap: LayerMap) {
    const fromDir = this.getLayerCachesDir()
    const toDir = this.getUnpackedTarDir()

    const moveLayer = async (layer: Layer) => {
      const from = path.join(fromDir, layer.id, `layer.tar`)
      const toPaths = layer.paths.map((layerPath) => path.join(toDir, layerPath))
      const to = toPaths[0]
      core.debug(`Moving layer tar from ${from} to ${to}`)

      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.rename(from, to)

      const cloneLayer = async (layerPath: string) => {
        core.debug(`Cloning layer tar from ${to} to ${layerPath}`)
        return fs.copyFile(to, layerPath)
      }
      return Promise.all(toPaths.slice(1).map(cloneLayer))
    }

    await Promise.all(layerMap.map(moveLayer))
  }

  private async storeLayers(layerTarFiles: string[]): Promise<number[]> {
    const pool = new PromisePool(this.concurrency)
    const promises = layerTarFiles.map(layerTarFile => pool.open((() => this.storeSingleLayer(layerTarFile))))

    return Promise.all(promises)
  }

  static async dismissError<T>(promise: Promise<T>, dismissStr: string, defaultResult: T): Promise<T> {
    try {
      return await promise
    } catch (e) {
      core.debug(`catch error: ${e.toString()}`)
      if (typeof e.message !== 'string' || !e.message.includes(dismissStr)) {
        core.error(`Unexpected error: ${e.toString()}`)
        throw e
      }

      core.info(`${dismissStr}: ${e.toString()}`)
      core.debug(e)
      return defaultResult
    }
  }

  private async storeSingleLayer(layerTarFile: string): Promise<number> {
    const layerId = this.getIdOfLayerTarFile(layerTarFile)
    const path = this.genSingleLayerStorePath(layerTarFile)
    const key = await this.generateSingleLayerSaveKey(layerId)

    core.info(`Start storing layer cache: ${JSON.stringify({ layerId, key })}`)
    const cacheId = await LayerCache.dismissError(cache.saveCache([path], key), LayerCache.ERROR_CACHE_ALREAD_EXISTS_STR, -1)
    core.info(`Stored layer cache: ${JSON.stringify({ key, cacheId })}`)

    core.debug(JSON.stringify({ log: `storeSingleLayer`, layerId, path, key, cacheId}))
    return cacheId
  }

  // ---

  async restore(primaryKey: string, restoreKeys?: string[]) {
    const restoredCacheKey = await this.restoreRoot(primaryKey, restoreKeys)
    if (restoredCacheKey === undefined) {
      core.info(`Root cache could not be found. aborting.`)
      return undefined
    }
    if (this.enabledParallel) {
      const layerMap = await loadLayerMap(this.getUnpackedTarDir())
      const diffidTarFiles = layerMap.map((layer) => path.join(layer.id, `layer.tar`))
      const hasRestoredAllLayers = await this.restoreLayers(diffidTarFiles)
      if (!hasRestoredAllLayers) {
        core.info(`Some layer cache could not be found. aborting.`)
        return undefined
      }
      await this.joinAllLayerCaches(layerMap)
      core.info(`Listing .`)
      await this.exec(`sh -c`, [`ls -lR`], { cwd: this.getUnpackedTarDir() })
    }
    await this.loadImageFromUnpacked()
    return restoredCacheKey
  }

  private async restoreRoot(primaryKey: string, restoreKeys?: string[]): Promise<string | undefined> {
    core.debug(`Trying to restore root cache: ${ JSON.stringify({ restoreKeys, dir: this.getUnpackedTarDir() }) }`)
    const restoredRootKey = await cache.restoreCache([this.getUnpackedTarDir()], primaryKey, restoreKeys)
    core.debug(`restoredRootKey: ${restoredRootKey}`)
    if (restoredRootKey === undefined) {
      return undefined
    }
    this.restoredRootKey = restoredRootKey
    core.info(`Listing .`)
    await this.exec(`sh -c`, [`ls -lR`], { cwd: this.getUnpackedTarDir() })

    return restoredRootKey
  }

  private async restoreLayers(layerTarFiles: string[]): Promise<boolean> {
    const pool = new PromisePool(this.concurrency)
    const tasks = layerTarFiles.map(layerTarFile => pool.open(() => this.restoreSingleLayer(layerTarFile)))

    try {
      await Promise.all(tasks)
    } catch (e) {
      if (typeof e.message === `string` && e.message.includes(LayerCache.ERROR_LAYER_CACHE_NOT_FOUND_STR)) {
        core.info(e.message)

        // Avoid UnhandledPromiseRejectionWarning
        tasks.map(task => task.catch(core.info))

        return false
      }
      throw e
    }

    return true
  }

  private async restoreSingleLayer(layerTarFile: string): Promise<string> {
    const layerId = this.getIdOfLayerTarFile(layerTarFile)
    const layerPath = this.genSingleLayerStorePath(layerTarFile)
    const key = await this.recoverSingleLayerKey(layerId)
    const dir = path.dirname(layerPath)

    core.debug(JSON.stringify({ log: `restoreSingleLayer`, layerId, layerPath, dir, key }))

    await fs.mkdir(dir, { recursive: true })
    const result = await cache.restoreCache([layerPath], key)

    if (result == null) {
      throw new Error(`${LayerCache.ERROR_LAYER_CACHE_NOT_FOUND_STR}: ${JSON.stringify({ layerId })}`)
    }

    return result
  }

  private async loadImageFromUnpacked() {
    await exec.exec(`sh -c`, [`tar cf - . | docker load`], { cwd: this.getUnpackedTarDir() })
  }

  async cleanUp() {
    await fs.rmdir(this.getImagesDir(), { recursive: true })
  }

  // ---

  getImagesDir(): string {
    return this.imagesDir
  }

  getUnpackedTarDir(): string {
    return path.join(this.getImagesDir(), this.getCurrentTarStoreDir())
  }

  getLayerCachesDir() {
    return `${this.getUnpackedTarDir()}-layers`
  }

  getCurrentTarStoreDir(): string {
    return 'image'
  }

  genSingleLayerStorePath(tarFile: string) {
    return path.join(this.getLayerCachesDir(), tarFile)
  }

  async generateRootHashFromManifest(): Promise<string> {
    return await getManifestHash(this.getUnpackedTarDir())
  }

  async generateRootSaveKey(): Promise<string> {
    const rootHash = await this.generateRootHashFromManifest()
    const formatted = await this.getFormattedSaveKey(rootHash)
    core.debug(JSON.stringify({ log: `generateRootSaveKey`, rootHash, formatted }))
    return `${formatted}-root`
  }

  async generateSingleLayerSaveKey(id: string) {
    const formatted = await this.getFormattedSaveKey(id)
    core.debug(JSON.stringify({ log: `generateSingleLayerSaveKey`, formatted, id }))
    return `layer-${formatted}`
  }
  
  async recoverSingleLayerKey(id: string) {
    const unformatted = await this.recoverUnformattedSaveKey()
    return format(`layer-${unformatted}`, { hash: id })
  }

  async getFormattedSaveKey(hash: string) {
    const result = format(this.unformattedSaveKey, { hash })
    core.debug(JSON.stringify({ log: `getFormattedSaveKey`, hash, result }))
    return result
  }

  async recoverUnformattedSaveKey() {
    const hash = await this.generateRootHashFromManifest()
    core.debug(JSON.stringify({ log: `recoverUnformattedSaveKey`, hash}))

    return this.restoredRootKey.replace(hash, `{hash}`).replace(/-root$/, ``)
  }

  getIdOfLayerTarFile(layerTarFile: string): string {
    return path.dirname(layerTarFile)
  }
}

export { LayerCache }
