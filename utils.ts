import { spawn } from "bun";

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
