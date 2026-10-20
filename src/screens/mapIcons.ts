// Icons per map category – shared by the (lazy) map screen and the place sheet.
import { Beer, Bus, Cross, DoorOpen, Droplet, Info, Music, Tent, Toilet, Utensils } from 'lucide-react'
import type { PoiCat } from '../data'

export const CAT_ICON: Record<PoiCat, typeof Droplet> = {
  stage: Music,
  water: Droplet,
  wc: Toilet,
  food: Utensils,
  medical: Cross,
  bar: Beer,
  entrance: DoorOpen,
  camping: Tent,
  info: Info,
  shuttle: Bus,
}
