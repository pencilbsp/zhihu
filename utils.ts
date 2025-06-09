import { spawn } from "bun";
import { join } from "path";

export async function macOCR(buffer: Buffer, language = "zh-Hans") {
    const fastMode = false;
    const languageCorrection = true;
    const languages = [language];

    const proc = spawn(
        [
            "ocrtool",
            languages.join(","),
            fastMode ? "true" : "false",
            languageCorrection ? "true" : "false",
            "-",
        ],
        {
            stdin: new Uint8Array(buffer),
        },
    );

    // 5. Đợi tiến trình kết thúc, thu stdout và stderr
    await proc.exited;
    const stdoutText = await new Response(proc.stdout).text();
    return stdoutText.trim();
}

export async function winOCR(buffer: Buffer, language = "zh-Hans-CN") {
    const proc = spawn(["ocrtool", "--language", language, "-"], {
        stdin: new Uint8Array(buffer),
    });

    // 5. Đợi tiến trình kết thúc, thu stdout và stderr
    await proc.exited;
    const stdoutText = await new Response(proc.stdout).text();
    return stdoutText.trim();
}

const fontValid = /url\("data:font\/(\w+);charset=utf-8;base64,(.*?)"\)/;

export async function decodeFont(font: { name: string; src: string }) {
    if (!fontValid.test(font.src)) {
        throw new Error("Invalid font format");
    }

    const [, extension, base64] = fontValid.exec(font.src) || [];

    const binStr = atob(base64!);
    const len = binStr.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        u8[i] = binStr.charCodeAt(i);
    }

    const fileExtension = "." + (extension || "ttf");
    const fileName = `${font.name.slice(0, 20)}${fileExtension}`;
    const filePath = join("fonts", fileName);

    await Bun.write(filePath, u8);

    await spawn(["ttx", "-f", "-q", filePath]).exited;

    return filePath.replace(fileExtension, ".ttx");
}

export function codePointToChar(cp: string): string {
    return String.fromCodePoint(parseInt(cp, 16));
}
