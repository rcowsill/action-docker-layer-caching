import { assertType } from 'typescript-is' 
import { promises as fs } from 'fs'
import * as path from 'path'
import * as core from '@actions/core'

export interface Manifest {
  Config: string
  RepoTags: string[] | null
  Layers: string[]
}

export type Manifests = Manifest[]

export interface ImageConfig_RootFS {
  "diff_ids": string[]
}

export interface ImageConfig {
  rootfs: ImageConfig_RootFS
}

export function assertManifests(x: unknown): asserts x is Manifests {
  assertType<Manifests>(x)
}

export function assertImageConfig(x: unknown): asserts x is ImageConfig {
  assertType<ImageConfig>(x)
}

export async function loadRawManifests(unpackedTarDir: string) {
  return (await fs.readFile(path.join(unpackedTarDir, `manifest.json`))).toString()
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

async function createLayerMap(unpackedTarDir: string, manifests: Manifests) {
  const configs = await loadImageConfigs(unpackedTarDir, manifests)
  
  const layerMap = new Map();
  configs.forEach((config, i) => {
    config.rootfs.diff_ids.forEach((id, j) => {
      const layerTarPaths = layerMap.get(id) ?? []
      layerTarPaths.push(manifests[i].Layers[j])
      layerMap.set(id, layerTarPaths)
    })
  })
  core.debug(`${JSON.stringify(layerMap.entries())}`)
}

export async function loadManifests(unpackedTarDir: string) {
  const raw = await loadRawManifests(unpackedTarDir)
  const parsedManifests = JSON.parse(raw)
  assertManifests(parsedManifests)

  const manifests = parsedManifests.map(convertManifestPaths)
  await createLayerMap(unpackedTarDir, manifests)

  return manifests
}
