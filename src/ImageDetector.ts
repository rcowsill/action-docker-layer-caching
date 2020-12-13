import * as exec from 'actions-exec-listener'
import * as core from '@actions/core'
import { assertType } from 'typescript-is' 

interface Image {
  ID: string
  Repository: string
  Tag: string
  Digest: string
}

function assertImage(x: unknown): asserts x is Image {
  assertType<Image>(x)
}

export class ImageDetector {
  async getExistingImages(): Promise<string[]> {
    const images = (await exec.exec(`docker`, [`images`, `--digests`, `--format={{json .}}`], { silent: true, listeners: { stderr: console.warn }})).stdoutStr.trim().split(`\n`)
    const ids = images.map((imageEntry) => {
      core.debug(imageEntry)
      const image: Image = JSON.parse(imageEntry)
      assertImage(image)
      if (image.Repository !== "<none>") {
        if (image.Tag !== "<none>") {
          return `${image.Repository}:${image.Tag}`
        } else if (image.Digest !== "<none>"){
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
