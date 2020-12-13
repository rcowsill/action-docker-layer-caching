import * as exec from 'actions-exec-listener'
import * as core from '@actions/core'
import { assertType } from 'typescript-is' 

interface Image {
  ID: string
  Repository: string | null
  Tag: string | null
  Digest: string | null
}

function assertImage(x: unknown): asserts x is Image {
  assertType<Image>(x)
}

export class ImageDetector {
  async getExistingImages(): Promise<string[]> {
    const images = (await exec.exec(`docker`, [`images`, `--digests`, `--format='{{json .}}'`], { silent: true, listeners: { stderr: console.warn }})).stdoutStr.split(`\n`)
    const ids = images.map((imageEntry) => {
      core.debug(imageEntry)
      const image: Image = JSON.parse(imageEntry)
      assertImage(image)
      if (image.Repository) {
        if (image.Tag) {
          return `${image.Repository}:${image.Tag}`
        } else {
          return `${image.Repository}:${image.Digest}`
        }
      }
      return image.ID
    })
    core.debug(JSON.stringify({ log: "getExistingImages", ids }))
    return ids
  }

  async getImagesShouldSave(alreadRegisteredImages: string[]): Promise<string[]> {
    const resultSet = new Set(await this.getExistingImages())
    alreadRegisteredImages.forEach(image => resultSet.delete(image))
    return Array.from(resultSet)
  }
}
