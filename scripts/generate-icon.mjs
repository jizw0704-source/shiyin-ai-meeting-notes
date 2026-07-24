import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "build", "icon.svg");
const outputDirectory = path.join(root, "build");
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const pngImages = await Promise.all(
  sizes.map((size) =>
    sharp(source)
      .resize(size, size)
      .png()
      .toBuffer(),
  ),
);

const directorySize = 6 + sizes.length * 16;
let imageOffset = directorySize;
const directory = Buffer.alloc(directorySize);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);

pngImages.forEach((image, index) => {
  const size = sizes[index];
  const entryOffset = 6 + index * 16;
  directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
  directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
  directory.writeUInt8(0, entryOffset + 2);
  directory.writeUInt8(0, entryOffset + 3);
  directory.writeUInt16LE(1, entryOffset + 4);
  directory.writeUInt16LE(32, entryOffset + 6);
  directory.writeUInt32LE(image.length, entryOffset + 8);
  directory.writeUInt32LE(imageOffset, entryOffset + 12);
  imageOffset += image.length;
});

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, "icon.ico"), Buffer.concat([directory, ...pngImages]));
await fs.writeFile(path.join(outputDirectory, "icon.png"), pngImages.at(-1));
