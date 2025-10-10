#!/usr/bin/env bun
import { JSDOM } from "jsdom";

const supportDomains = ["togetherii.com", "welove-gourmet.com", "niice-woker.com"];

async function paserChapterList(url: string) {
    const { hostname } = new URL(url);
    if (!supportDomains.includes(hostname)) {
        throw new Error(`Unsupported domain: ${hostname}`);
    }
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const ulElm = document.getElementById("chapterlist");
    if (!ulElm) throw new Error("Chapter list not found");

    const liElms = ulElm.querySelectorAll("li");
    if (!liElms) throw new Error("Chapter list items not found");

    return Array.from(liElms).map((liElm) => {
        const aElm = liElm.querySelector("a");
        if (!aElm) throw new Error("Chapter link not found");
        const url = aElm.getAttribute("href");
        if (!url) throw new Error("Chapter link not found");
        const title = aElm.querySelector("em");
        if (!title || !title.textContent.trim()) throw new Error("Chapter title not found");

        return { url, title: title.textContent.trim() };
    });
}

async function paserChapter(url: string) {
    const { hostname } = new URL(url);
    if (!supportDomains.includes(hostname)) {
        throw new Error(`Unsupported domain: ${hostname}`);
    }
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const novelcontentElm = document.querySelector(".novelcontent");
    if (!novelcontentElm) throw new Error("Novel content not found");

    // 1️⃣ Tạo bảng ánh xạ class icon → ký tự thật
    const iconMap: Record<string, string> = {};
    const styleElms = document.querySelectorAll("style");
    for (const styleElm of styleElms) {
        const css = styleElm.textContent;
        if (!css) continue;

        // match ví dụ: .icon-122:before { content: "\65e5"; }
        const regex = /\.icon-(\d+):before\s*\{\s*content:\s*["']\\([0-9a-fA-F]+)["'];\s*\}/g;
        let match;
        while ((match = regex.exec(css))) {
            const iconId = match[1];
            const hexCode = match[2];
            if (!hexCode) continue;
            iconMap[`icon-${iconId}`] = String.fromCharCode(parseInt(hexCode, 16));
        }
    }

    // 2️⃣ Duyệt từng <p>, thay thế <i class="icon-xxx">
    const pElms = novelcontentElm.querySelectorAll("p");
    const texts = Array.from(pElms).map((pElm) => {
        // clone innerHTML để xử lý
        let html = pElm.innerHTML;
        html = html.replace(/<i class="icon-(\d+)"><\/i>/g, (_, num) => {
            const key = `icon-${num}`;
            return iconMap[key] || ""; // thay thế bằng ký tự thật
        });

        // parse lại thành text thuần
        const temp = new JSDOM(html).window.document.body;
        return temp.textContent.trim();
    });

    console.log(texts.join("\n"));
}

async function main() {
    const [cmd, url] = process.argv.slice(2);
    if (!url) {
        console.error("Usage: bun comic.ts <url>");
        process.exit(1);
    }
    if (cmd === "list") {
        const chapters = await paserChapterList(url);
        console.table(chapters);
    } else if (cmd === "chapter") {
        await paserChapter(url);
    } else {
        console.error("Unknown command. Use 'list' or 'chapter'");
        process.exit(1);
    }
}

main();
