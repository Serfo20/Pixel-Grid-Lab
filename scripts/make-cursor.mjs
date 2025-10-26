import sharp from "sharp";

const input = "public/cursors/arrow.png";
const output = "public/cursors/arrow-32.png";

await sharp(input)
  .resize(32, 32, { kernel: "nearest" }) // yo: nearest neighbor
  .png()
  .toFile(output);

console.log("Listo:", output);