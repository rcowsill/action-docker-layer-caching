import { assertType } from 'typescript-is' 
import { promises as fs } from 'fs'
import crypto from 'crypto'
import * as path from 'path'
import * as core from '@actions/core'

interface Manifest {
  Config: string
  RepoTags: string[] | null
  Layers: string[]
}

type Manifests = Manifest[]

interface ImageConfig_RootFS {
  "diff_ids": string[]
}

interface ImageConfig {
  rootfs: ImageConfig_RootFS
}

export interface Layer {
  id: string
  paths: string[]
}

export type LayerMap = Layer[]

function assertManifests(x: unknown): asserts x is Manifests {
  assertType<Manifests>(x)
}

function assertImageConfig(x: unknown): asserts x is ImageConfig {
  assertType<ImageConfig>(x)
}

async function loadRawManifests(unpackedTarDir: string) {
  return (await fs.readFile(path.join(unpackedTarDir, `manifest.json`))).toString()
}

async function loadManifests(unpackedTarDir: string) {
  const raw = await loadRawManifests(unpackedTarDir)
  const parsedManifests = JSON.parse(raw)
  assertManifests(parsedManifests)

  const manifests = parsedManifests.map(convertManifestPaths)

  return manifests
}

function convertManifestPaths(manifest: Manifest) {
  const convertPosixPath = (layerPath: string) => layerPath.split(path.posix.sep).join(path.sep)
  manifest.Layers = manifest.Layers.map(convertPosixPath)

  return manifest
}

async function loadImageConfig(configPath: string) {
  const raw = await fs.readFile(configPath)
  const parsedConfig = JSON.parse(raw.toString())
  assertImageConfig(parsedConfig)
  return parsedConfig
}

async function loadImageConfigs(unpackedTarDir: string, manifests: Manifests) {
  const promises = manifests.map((manifest) => loadImageConfig(path.join(unpackedTarDir, manifest.Config)))
  return Promise.all(promises)
}

function convertLayerMap(layerMap: Map<string, Set<string>>): LayerMap {
  const result: LayerMap = []
  layerMap.forEach((paths, id) => {
    result.push({
       "id": id,
       "paths": [...paths]
    })
  })
  return result
}

export async function loadLayerMap(unpackedTarDir: string): Promise<LayerMap> {
  const manifests = await loadManifests(unpackedTarDir)
  const configs = await loadImageConfigs(unpackedTarDir, manifests)

  const layerMap = new Map()
  configs.forEach((config, i) => {
    config.rootfs.diff_ids.forEach((diffId, j) => {
      const id = diffId.replace(":", path.sep)
      if (!layerMap.has(id)) {
        layerMap.set(id, new Set())
      }
      layerMap.get(id).add(manifests[i].Layers[j])
    })
  })

  layerMap.forEach((paths, id) => {
    core.debug(`${JSON.stringify([id, [...paths]])}`)
  })

  return convertLayerMap(layerMap)
}

export async function getManifestHash(unpackedTarDir: string) {
  const raw = await loadRawManifests(unpackedTarDir)
  return crypto.createHash(`sha256`).update(raw, `utf8`).digest(`hex`)
}
