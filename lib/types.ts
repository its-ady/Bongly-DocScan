export type DocId = 'aadhaar' | 'voter' | 'pan' | 'ration' | 'others'

export type ExportSize =
  | 'original'
  | 'under300'
  | 'under200'
  | 'under100'
  | 'under50'

export interface DocConfig {
  id: DocId
  name: string
  sides: ('front' | 'back')[]
  description: string
}

export interface DocData {
  // data URLs of the cropped images, indexed by side order
  front?: string
  back?: string
}

export type DocStore = Record<DocId, DocData>

export const DOC_CONFIGS: DocConfig[] = [
  {
    id: 'aadhaar',
    name: 'Aadhaar Card',
    sides: ['front', 'back'],
    description: 'Front & back',
  },
  {
    id: 'voter',
    name: 'Voter Card',
    sides: ['front', 'back'],
    description: 'Front & back',
  },
  {
    id: 'pan',
    name: 'PAN Card',
    sides: ['front'],
    description: 'Single side',
  },
  {
    id: 'ration',
    name: 'Ration Card',
    sides: ['front', 'back'],
    description: 'Front & back',
  },
  {
    id: 'others',
    name: 'Others Docs',
    sides: ['front'],
    description: 'Arrange multiple photos on A4',
  },
]

export const EXPORT_SIZE_OPTIONS: { value: ExportSize; label: string; maxKB: number | null }[] = [
  { value: 'original', label: 'Original (best quality)', maxKB: null },
  { value: 'under300', label: 'Under 300 KB', maxKB: 300 },
  { value: 'under200', label: 'Under 200 KB', maxKB: 200 },
  { value: 'under100', label: 'Under 100 KB', maxKB: 100 },
  { value: 'under50', label: 'Under 50 KB', maxKB: 50 },
]

export function getDocConfig(id: DocId): DocConfig {
  return DOC_CONFIGS.find((d) => d.id === id)!
}

export function isDocComplete(config: DocConfig, data: DocData | undefined): boolean {
  if (!data) return false
  return config.sides.every((side) => Boolean(data[side]))
}
