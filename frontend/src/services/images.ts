export function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法读取图片'))
    image.src = url
  })
}

export async function fetchDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('读取图片失败')
  return readFile(await response.blob())
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}
