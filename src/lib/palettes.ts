export type RGB = [number, number, number]


// DB16: DawnBringer 16
export const DB16: RGB[] = [
[20,12,28], [68,36,52], [48,52,109], [78,74,78],
[133,76,48], [52,101,36], [208,70,72], [117,113,97],
[89,125,206], [210,125,44], [133,149,161], [109,170,44],
[210,170,153], [109,194,202], [218,212,94], [222,238,214]
]


export type PaletteMode = "none" | "db16" | "rgb332"


export function nearestDB16([r,g,b]: RGB): RGB {
let best: RGB = DB16[0]
let bestD = Infinity
for (const p of DB16){
const dr=r-p[0], dg=g-p[1], db=b-p[2]
const d = dr*dr+dg*dg+db*db
if(d<bestD){ bestD=d; best=p }
}
return best
}


export function toRGB332([r,g,b]: RGB): RGB {
// 3 bits R, 3 bits G, 2 bits B
const R = Math.round(r/255*7)
const G = Math.round(g/255*7)
const B = Math.round(b/255*3)
return [
Math.round(R*255/7),
Math.round(G*255/7),
Math.round(B*255/3),
]
}