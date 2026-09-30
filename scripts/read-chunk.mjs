import { readFileSync } from "node:fs";
const [file, offset = "0", length = "20000"] = process.argv.slice(2);
const data = readFileSync(file, "utf8");
console.log(
  JSON.stringify({
    length: data.length,
    chunk: data.slice(Number(offset), Number(offset) + Number(length)),
  }),
);
