ZhiHu CLI Tool

A command-line interface for extracting and decoding text from Zhihu pages using Puppeteer and custom font mappings.

🚀 Installation

1. Binary Releases (For End Users)
	•	Download the pre-built executable for your platform from the GitHub Releases page.
	•	Extract the archive and add the executable (zhihu or zhihu.exe) to your PATH if desired.

2. Development Mode (For Developers / Contributors)
	1.	Clone the repository and install dependencies:

git clone https://github.com/pencilbsp/zhihu.git
cd zhihu


	2.	Ensure you have Bun installed (latest version recommended):

bun --version
# If not installed or outdated, install/update:
curl -fsSL https://bun.sh/install | bash


	3.	Install project dependencies:

bun install


	4.	Link the CLI locally (optional):

bun link .



📦 Dependencies

Before running the CLI, ensure the following tools are installed and available in your PATH:
	•	Python3: Required to execute the ttx command from FontTools.
	•	FontTools (ttx): Installs the ttx utility for converting binary font files to XML. Install via:

pip3 install fonttools


	•	Bun Runtime: For development mode (latest version recommended).

The CLI uses a fonts/ directory to temporarily store downloaded font files and their .ttx exports. Ensure the process can create and write to this folder.

⚙️ Configuration
	•	CHROME_PATH: (Optional) Override the path to the Chrome executable.
	•	BUN_APPDIR: (Optional) Path to Bun’s application data directory.

🎮 Usage

Once you have the zhihu executable available (either via release or local link):

zhihu [options] <zhihu-url>

Modes
	1.	Login Mode (--login)
	•	Opens an interactive browser session for manual login.
	•	Usage:

zhihu --login --url https://www.zhihu.com/question/123456


	•	Exit the session with Ctrl+C.

	2.	Parsing Mode (Default)
	•	Headlessly fetches and decodes text.
	•	Supports cookies for authenticated scraping.

Common Options

Flag	Description	Default
--login	Open Chrome for manual login. Exit by pressing Ctrl+C.	false
--url <url>	Zhihu page URL to process (required).	—
--chrome-path <path>	Custom path to the Chrome executable.	Platform default
--app-dir <dir>	Chrome user data directory (preserve session).	—
--cookies <path>, -c	JSON file of Puppeteer cookies for authenticated parsing.	—
--output <file>, -o	File path for extracted text.	output.txt

Default Chrome Paths
	•	Windows: C:\Program Files\Google\Chrome\Application\chrome.exe
	•	macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

✨ Features
	•	Extracts text from headings (h1–h6) and paragraphs (p) within #manuscript.
	•	Decodes custom fonts via MD5-to-Unicode mappings (SourceHanSansCN-Regular.json).
	•	Supports both interactive and headless modes.

📝 Examples
	•	Interactive Login:

zhihu --login --url https://www.zhihu.com/question/123456


	•	Headless Parsing with Cookies:

zhihu -c cookies.json -o answer.txt https://www.zhihu.com/question/123456


	•	Using Custom Chrome Path:

export CHROME_PATH="/usr/bin/google-chrome-stable"
zhihu --url https://www.zhihu.com/question/123456



📄 Output

Writes each decoded line to the specified output file, preserving original element order.

📜 License

Distributed under the MIT License.
