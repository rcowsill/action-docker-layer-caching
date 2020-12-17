import { assertType } from 'typescript-is' 
import { promises as fs } from 'fs'
import * as path from 'path'

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

export async function loadRawManifests(rootPath: string) {
  return (await fs.readFile(path.join(rootPath, `manifest.json`))).toString()
}

function convertLayerPaths(manifest: Manifest) {
  const convertPosixPath = (layerPath: string) => layerPath.split(path.posix.sep).join(path.sep)
  manifest.Layers = manifest.Layers.map(convertPosixPath)

  return manifest
}

export async function loadManifests(path: string) {
  const raw = await loadRawManifests(path)
  const manifests = JSON.parse(raw.toString())
  assertManifests(manifests)

  return manifests.map(convertLayerPaths)
}