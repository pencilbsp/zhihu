import { dumpFont } from "./font";

const fontName = "SourceHanSansCN-Regular";

try {
    const fontXml = await Bun.file(fontName + ".ttx").text();
    const fontData = await dumpFont(fontXml, true);

    await Bun.write(fontName + ".json", JSON.stringify(fontData));
} catch (error) {
    console.error("Error:", error);
}
