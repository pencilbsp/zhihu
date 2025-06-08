import { macOCR, getText } from "./utils";

async function main() {
    // const textFile = Bun.file("test.txt");
    // const textContent = await textFile.text();

    // const textLines = textContent.split("\n");
    // const lines = textLines
    //     .filter((t) => t.trim())
    //     .map((line, index) => ({ text: line, index }));

    // const results = new Array(lines.length).fill("");

    // let done = 0;
    // const CONCURRENCY = 10;
    // const tasks = lines.map((item, i) => async () => {
    //     if (item.index !== null) {
    //         const ocrText = await macOCR(item.text);
    //         done++;
    //         results[i] = ocrText.split("\n").join(" ");
    //         console.log(`Done ${done}/${lines.length}: ${results[i]}`);
    //         // Thay newline bằng space, theo yêu cầu trước
    //     }
    // });

    // // 5. Thực thi theo từng "lô" (batch) 10 tasks một
    // for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    //     const batch = tasks.slice(i, i + CONCURRENCY);
    //     // Chạy đồng thời 10
    //     await Promise.all(batch.map((fn) => fn()));
    // }

    // const allText = results.join("\n");

    // await Bun.write("output.txt", allText);

    const data = await getText(
        "https://www.zhihu.com/market/paid_column/1822324978940571648/section/1824497947582267392",
    );

    // console.log(data);
}

try {
    await main();
} catch (error) {
    console.error(error);
}
