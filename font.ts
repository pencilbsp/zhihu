import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";

// Khởi tạo parser với tuỳ chọn để đọc thuộc tính
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
});

interface Point {
    x: number;
    y: number;
    on: boolean;
}

interface Glyph {
    name: string;
    bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
    contours: Point[][];
    md5: string;
}

// --- 1) Định nghĩa overloads ---
export async function dumpFont(
    xml: string,
): Promise<(Glyph & { code: string })[]>;
export async function dumpFont(
    xml: string,
    reverse: true,
): Promise<Record<string, string>>;

async function dumpFont(xml: string, reverse = false) {
    const jsonObj = parser.parse(xml);
    const glyphs: Glyph[] = jsonObj.ttFont.glyf.TTGlyph.map(
        (glyphObj: {
            contour: any[];
            instructions: string;
            "@_name": string;
            "@_xMin": string;
            "@_yMin": string;
            "@_xMax": string;
            "@_yMax": string;
        }) => {
            const name = glyphObj["@_name"];
            const bbox = {
                xMin: Number(glyphObj["@_xMin"] || 0),
                yMin: Number(glyphObj["@_yMin"] || 0),
                xMax: Number(glyphObj["@_xMax"] || 0),
                yMax: Number(glyphObj["@_yMax"] || 0),
            };

            const contours: Point[][] =
                glyphObj.contour && Array.isArray(glyphObj.contour)
                    ? glyphObj.contour.map((contour: any) => {
                          if (!contour) return [];
                          const pts = Array.isArray(contour.pt)
                              ? contour.pt
                              : [contour.pt];
                          return pts.map((pt: any) => ({
                              x: Number(pt["@_x"]),
                              y: Number(pt["@_y"]),
                              on: pt["@_on"] === "1",
                          }));
                      })
                    : [];

            // Đảm bảo contour luôn là mảng
            const uniq = `${bbox.xMax},${bbox.yMax},${bbox.xMin},${bbox.yMin},${contours.length}`;

            const md5 = createHash("md5").update(uniq).digest("hex");

            return { name, bbox, contours, md5 };
        },
    );

    const map: { "@_code": string; "@_name": string }[] =
        jsonObj.ttFont.cmap["cmap_format_4"][0].map;

    const table = map.reduce(
        (acc, item) => {
            acc[item["@_name"]] = item["@_code"];
            return acc;
        },
        {} as Record<string, string>,
    );

    // const data = glyphs.map((glyph) => {
    //     if (!table[glyph.name]) {
    //         console.log(`Glyph ${glyph.name} not found in table`);
    //     }
    //     return `${table[glyph.name]}|${glyph.md5}`;
    // });
    //
    const data = glyphs.map((glyph) => ({ ...glyph, code: table[glyph.name] }));

    if (reverse) {
        return data.reduce(
            (acc, glyph) => {
                if (!glyph.code) {
                    // console.log(`Glyph ${glyph.name} not found in table`);
                } else {
                    acc[glyph.md5] = glyph.code;
                }
                return acc;
            },
            {} as Record<string, string>,
        );
    }

    return data;
}

const codeToChar = (code: string) => {
    const cp = parseInt(code, 16);
    return String.fromCodePoint(cp);
};

try {
    const fontA = "zhihu_font";
    const fontB = "SourceHanSansCN-Regular#1";

    const fontAXml = await Bun.file(fontA + ".ttx").text();
    const fontBXml = await Bun.file(fontB + ".ttx").text();

    const [fontAData, fontBData] = await Promise.all([
        dumpFont(fontAXml),
        dumpFont(fontBXml, true),
    ]);

    const charMap: { from: string; to: string }[] = [];
    for (const glyph of fontAData) {
        if (fontBData[glyph.md5]) {
            console.log(
                codeToChar(glyph.code),
                "->",
                codeToChar(fontBData[glyph.md5]!),
            );
            charMap.push({ from: glyph.code, to: fontBData[glyph.md5]! });
        }
    }

    console.log(charMap);
} catch (error) {
    console.log(error);
}
