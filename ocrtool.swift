//
//  main.swift
//  OCR
//
//  Created by xulihang on 2023/1/1.
//

import Cocoa
import Foundation
import Vision

var REVISION: Int

if #available(macOS 13, *) {
    REVISION = VNRecognizeTextRequestRevision3
} else if #available(macOS 11, *) {
    REVISION = VNRecognizeTextRequestRevision2
} else {
    REVISION = VNRecognizeTextRequestRevision1
}

// MARK: – Đọc ảnh PNG từ stdin
func loadImageFromStdin() throws -> NSImage {
    let stdinData = FileHandle.standardInput.readDataToEndOfFile()
    if stdinData.isEmpty {
        throw NSError(
            domain: "OCR", code: -1,
            userInfo: [NSLocalizedDescriptionKey: "No data received on stdin"])
    }
    guard let nsImage = NSImage(data: stdinData) else {
        throw NSError(
            domain: "OCR", code: -1,
            userInfo: [NSLocalizedDescriptionKey: "Cannot create NSImage from stdin data"])
    }
    return nsImage
}

// MARK: – Đọc ảnh từ file hệ thống
func loadImageFromFile(path: String) throws -> NSImage {
    let fileURL = URL(fileURLWithPath: path)
    guard FileManager.default.fileExists(atPath: fileURL.path) else {
        throw NSError(
            domain: "OCR", code: -1,
            userInfo: [NSLocalizedDescriptionKey: "File not found: \(path)"])
    }
    guard let nsImage = NSImage(byReferencingFile: path) else {
        throw NSError(
            domain: "OCR", code: -1,
            userInfo: [NSLocalizedDescriptionKey: "Cannot load image at path: \(path)"])
    }
    return nsImage
}

func detectText(
    image: NSImage,
    languages: [String],
    mode: VNRequestTextRecognitionLevel,
    languageCorrection: Bool
) -> String? {
    // 1) Chuyển NSImage → CGImage
    guard let imgRef = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return nil
    }

    var ocrError: Error?
    var ocrResult: String?
    let request = VNRecognizeTextRequest { (request, error) in
        if let err = error {
            ocrError = err
            return
        }
        guard let observations = request.results as? [VNRecognizedTextObservation] else {
            return
        }
        // Gom từng dòng thành một chuỗi
        let lines: [String] = observations.compactMap { obs in
            obs.topCandidates(1).first?.string
        }
        ocrResult = lines.joined(separator: "\n")
    }
    request.revision = REVISION
    request.recognitionLevel = mode
    request.recognitionLanguages = languages
    request.usesLanguageCorrection = languageCorrection

    do {
        try VNImageRequestHandler(cgImage: imgRef, options: [:]).perform([request])
    } catch {
        // Nếu xảy ra lỗi ngay khi gọi perform, trả nil
        return nil
    }
    try? VNImageRequestHandler(cgImage: imgRef, options: [:]).perform([request])

    // 5) Nếu có lỗi trong closure, in ra stderr rồi trả nil
    if let err = ocrError {
        fputs("OCR Error: \(err)\n", stderr)
        return nil
    }
    return ocrResult
}

func main(args: [String]) -> Int32 {
    let args = CommandLine.arguments
    // Nếu chỉ truyền "--langs", in ra danh sách ngôn ngữ được hỗ trợ
    if args.count == 2, args[1] == "--langs" {
        let tempRequest = VNRecognizeTextRequest()
        tempRequest.revision = VNRecognizeTextRequestRevision3
        tempRequest.recognitionLevel = .accurate
        if let langs = try? tempRequest.supportedRecognitionLanguages() {
            for langCode in langs {
                print(langCode)
            }
        }
        return 0
    }
    // Cú pháp: ocr <languages> <fastMode> <languageCorrection> <imagePath or -> [outputPath]
    // args.count == 5 hoặc 6
    if args.count == 5 || args.count == 6 {
        let languageArg = args[1]
        let fastModeArg = args[2]
        let langCorrectionArg = args[3]
        let imagePathArg = args[4]
        let outputPathArg: String? = (args.count == 6 ? args[5] : nil)

        // Parse languages (có thể nhiều code cách nhau bởi dấu phẩy)
        let languages = languageArg.split(separator: ",").map { String($0) }

        // Parse fastMode
        var fastMode = VNRequestTextRecognitionLevel.accurate  // or .fast
        if fastModeArg == "true" {
            fastMode = VNRequestTextRecognitionLevel.fast
        } else {
            fastMode = VNRequestTextRecognitionLevel.accurate
        }

        // Parse languageCorrection
        let useLanguageCorrection = (langCorrectionArg.lowercased() == "true")

        // Load ảnh
        let nsImage: NSImage
        do {
            if imagePathArg == "-" {
                nsImage = try loadImageFromStdin()
            } else {
                nsImage = try loadImageFromFile(path: imagePathArg)
            }
        } catch {
            fputs("Error loading image: \(error.localizedDescription)\n", stderr)
            return 1
        }

        // Thực thi OCR
        guard
            let detected = detectText(
                image: nsImage,
                languages: languages,
                mode: fastMode,
                languageCorrection: useLanguageCorrection)
        else {
            fputs("Error: OCR failed or no text detected.\n", stderr)
            return 1
        }

        // Nếu người dùng truyền outputPath, ghi ra file; còn không, in ra stdout
        if let outPath = outputPathArg {
            do {
                try detected.write(
                    toFile: outPath,
                    atomically: true,
                    encoding: String.Encoding.utf8)
            } catch {
                fputs("Error writing to file '\(outPath)': \(error.localizedDescription)\n", stderr)
                return 1
            }
        } else {
            print(detected)
        }
        return 0
    }
    // Nếu sai cú pháp, in hướng dẫn
    let prog = String((args.first ?? "ocrtool"))
    fputs(
        """
        usage:
          \(prog) --langs
            ⇒ Liệt kê các ngôn ngữ được hỗ trợ.

          \(prog) <languages> <fastMode> <languageCorrection> <imagePath or -> [outputPath]
            ⇒ Thực hiện OCR.
               languages: danh sách code ngôn ngữ, ví dụ "en-US" hay "vi-VN" hay "zh-Hans"
                          hoặc kết hợp "vi-VN,zh-Hans,en-US".
               fastMode: "true" hoặc "false".
               languageCorrection: "true" hoặc "false".
               imagePath: đường dẫn tới ảnh (PNG/JPEG/...). Nếu muốn đọc ảnh từ stdin (PNG bytes), đặt là "-".
               outputPath: (tuỳ chọn) nếu truyền thì lưu kết quả vào file; không thì in ra màn hình.

        examples:
          # In danh sách ngôn ngữ hỗ trợ:
          \(prog) --langs

          # OCR từ file, in ra stdout:
          \(prog) "en-US" false false ./input.png

          # OCR từ file, lưu kết quả vào output.txt:
          \(prog) "vi-VN,zh-Hans" false true ./input.png ./output.txt

          # OCR từ stdin (ví dụ qua pipe), in ra stdout:
          cat input.png | \(prog) "en-US" true false -

          # OCR từ stdin, lưu ra file:
          cat input.png | \(prog) "en-US" true false - ./output.txt
        """, stderr)
    return 1
}

exit(main(args: CommandLine.arguments))
