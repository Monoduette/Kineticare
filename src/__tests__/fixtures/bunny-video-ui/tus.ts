import type { UploadOptions } from 'tus-js-client'
export const tusFixture = {
  starts: 0,
  aborts: [] as boolean[],
  instances: [] as Upload[],
  succeed: () => {
    tusFixture.instances
      .at(-1)
      ?.options.onSuccess?.({} as Parameters<NonNullable<UploadOptions['onSuccess']>>[0])
  },
}
export class Upload {
  url: string | null = null
  constructor(
    public file: File,
    public options: UploadOptions,
  ) {
    tusFixture.instances.push(this)
  }
  start() {
    tusFixture.starts++
    this.url = 'https://video.bunnycdn.com/tusupload/DUMMY-fixture'
    this.options.onProgress?.(50, 100)
  }
  async abort(terminate = false) {
    tusFixture.aborts.push(terminate)
  }
}
