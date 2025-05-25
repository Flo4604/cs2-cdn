import EventEmitter from "node:events";
import { readdir, rename } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import vpk from "vpk";
import { exec } from "node:child_process";
import { HttpClient } from "@doctormckay/stdlib/http.js";
import AdmZip from "adm-zip";
import winston from "winston";
import os from "node:os";
import { pid } from "node:process";

interface Config {
  directory: string;
  updateInterval: number;
  stickers: boolean;
  patches: boolean;
  graffiti: boolean;
  characters: boolean;
  musicKits: boolean;
  cases: boolean;
  tools: boolean;
  statusIcons: boolean;
  weapons: boolean;
  otherWeapons: boolean;
  setIcons: boolean;
  seasonIcons: boolean;
  premierSeasons: boolean;
  tournaments: boolean;
  logLevel: string;
  source2Viewer: string;
  depotDownloader: string;
  fileList: string;
}

const DEFAULT_CONFIG: Config = {
  directory: "data",
  updateInterval: 30000,
  stickers: true,
  patches: true,
  graffiti: true,
  characters: true,
  musicKits: true,
  cases: true,
  tools: true,
  statusIcons: true,
  weapons: true,
  otherWeapons: true,
  setIcons: true,
  seasonIcons: true,
  premierSeasons: true,
  tournaments: true,
  logLevel: "info",
  source2Viewer: "Source2Viewer-CLI",
  depotDownloader: "DepotDownloader",
  fileList: "filelist.txt",
};

const APP_ID = 730;
const DEPOT_ID = 2347770;

const ECON_PATH = "panorama/images/econ";

const neededDirectories: Record<string, string> = {
  stickers: `${ECON_PATH}/stickers`,
  patches: `${ECON_PATH}/patches`,
  graffiti: `${ECON_PATH}/stickers/default`,
  characters: `${ECON_PATH}/characters`,
  musicKits: `${ECON_PATH}/music_kits`,
  cases: `${ECON_PATH}/weapon_cases`,
  tools: `${ECON_PATH}/tools`,
  statusIcons: `${ECON_PATH}/status_icons`,
  weapons: `${ECON_PATH}/default_generated`,
  otherWeapons: `${ECON_PATH}/weapons`,
  seasonIcons: `${ECON_PATH}/season_icons`,
  premierSeasons: `${ECON_PATH}/premier_seasons`,
  tournaments: `${ECON_PATH}/tournaments`,
  setIcons: `${ECON_PATH}/set_icons`,
};

const neededFiles: Record<string, string> = {
  itemsGame: "scripts/items/items_game.txt",
  csgoEnglish: "resource/csgo_english.txt",
};

const fileLookup: Record<string, number> = {};

for (const key of Object.keys(neededFiles)) {
  fileLookup[neededFiles[key]] = 1;
}

class Cs2CDN extends EventEmitter {
  private config: Config;
  private client: HttpClient;
  private log: winston.Logger;
  private vpkDir: vpk;
  private vpkStickerFiles: string[] = [];
  private vpkPatchFiles: string[] = [];
  private vpkStatusIconFiles: string[] = [];
  private weaponFiles: string[] = [];

  constructor(config: Partial<Config>) {
    super();

    this.config = Object.assign({}, DEFAULT_CONFIG, config);

    this.createDataDirectory();

    this.client = new HttpClient({
      defaultHeaders: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
      },
    });

    this.log = winston.createLogger({
      level: this.config.logLevel,
      transports: [
        new winston.transports.Console({
          format: winston.format.printf((info) => {
            return `[cs2cdn.com] ${info.level}: ${info.message}`;
          }),
        }),
      ],
    });

    this.updateLoop();
  }

  createDataDirectory(): void {
    const dir = `./${this.config.directory}`;

    if (!existsSync(dir)) {
      mkdirSync(dir);
    }
  }

  updateLoop(): void {
    if (this.config.updateInterval > 0) {
      this.log.info(
        `Auto-updates enabled, checking for updates every ${this.config.updateInterval} seconds`,
      );
      this.update().then(() => {
        setTimeout(() => {
          this.updateLoop();
        }, this.config.updateInterval * 1000);
      });
    } else {
      this.log.info("Auto-updates disabled, checking if required files exist");

      try {
        this.loadVPK();
      } catch (e) {
        this.log.warn("Needed CS:GO files not installed");
        this.update();
      }
    }
  }

  async update(): Promise<void> {
    this.log.info("Checking for CS:GO file updates");

    if (!existsSync(`${this.config.directory}/${this.config.source2Viewer}`)) {
      this.log.error(
        `Source 2 Viewer not found at ${this.config.source2Viewer}, downloading...`,
      );
      await this.downloadVRF();
    }

    if (
      !existsSync(`${this.config.directory}/${this.config.depotDownloader}`)
    ) {
      this.log.error(
        `DepotDownloader binary not found at ${this.config.depotDownloader}, downloading...`,
      );
      await this.downloadDepotDownloader();
    }

    writeFileSync(
      `${this.config.directory}/${this.config.fileList}-${pid}`,
      "game\\csgo\\pak01_dir.vpk",
    );

    this.log.debug("Downloading require static files");

    await this.downloadFiles();

    unlinkSync(`${this.config.directory}/${this.config.fileList}-${pid}`);

    this.log.debug("Loading static file resources");

    this.loadVPK();

    await this.downloadVPKFiles();

    await this.dumpFiles();
    await this.renameFiles();

    this.log.info("Finished updating CS:GO files");

    process.exit(0);
  }

  async dumpFiles() {
    try {
      const pathsToDump = Object.keys(neededDirectories)
        .filter((f) => this.config[f as keyof Config] === true)
        .map((f) => neededDirectories[f])
        .concat(Object.keys(neededFiles).map((f) => neededFiles[f]));

      await Promise.all(
        pathsToDump.map(
          (path) =>
            new Promise<void>((resolve, reject) => {
              this.log.debug(`Dumping ${path}...`);
              exec(
                `${this.config.directory}/${this.config.source2Viewer} --input data/game/csgo/pak01_dir.vpk --vpk_filepath ${path} -o data -d > /dev/null`,
                (error) => {
                  if (error) {
                    this.log.error("Exec error:", error);
                  }

                  resolve();
                },
              );
            }),
        ),
      );
    } catch (error) {
      this.log.error("Error dumping files:", error);
    }
  }

  async renameFiles() {
    try {
      const files = await readdir(this.config.directory, {
        withFileTypes: true,
        recursive: true,
      });

      for (const file of files) {
        if (file.isFile() && file.name.endsWith("_png.png")) {
          const oldPath = join(file.parentPath, file.name);

          const newName = `${basename(file.name, "_png.png")}.png`;
          const newPath = join(dirname(oldPath), newName);

          await rename(`./${oldPath}`, `./${newPath}`);
        }
      }

      this.log.info("Succesfully renamed files");
    } catch (error) {
      this.log.error("Error renaming files", error);
    }
  }

  getPlatform(): string {
    const platform = os.platform();
    const architecture = os.arch();

    let osName = "";
    let archName = "";

    switch (platform) {
      case "win32":
        osName = "windows";
        break;
      case "darwin":
        osName = "macos";
        break;
      case "linux":
        osName = "linux";
        break;
      default:
        osName = "unknown";
    }

    switch (architecture) {
      case "x64":
        archName = "x64";
        break;
      case "arm64":
        archName = "arm64";
        break;
      case "arm":
        archName = "arm";
        break;
      default:
        archName = "unknown";
    }

    return `${osName}-${archName}`;
  }

  async getLatestGitTag(repository: string): Promise<string> {
    const latestTag = await this.client.request({
      method: "GET",
      url: `https://api.github.com/repos/${repository}/releases/latest`,
    });

    if (latestTag.statusCode !== 200) {
      throw new Error(`Failed to get latest release ${latestTag.statusCode}`);
    }

    return latestTag?.jsonBody?.tag_name;
  }

  async getBinary(
    repository: string,
    binaryName: string,
    afterExtractionName?: string,
  ): Promise<void> {
    const latestTag = await this.getLatestGitTag(repository);
    const platform = this.getPlatform();

    const binary = await this.client.request({
      method: "GET",
      followRedirects: true,
      url: `https://github.com/${repository}/releases/download/${latestTag}/${binaryName}-${platform}.zip`,
    });

    if (binary.statusCode !== 200 && binary.statusCode !== 302) {
      throw new Error(`Failed to get latest release ${binary.statusCode}`);
    }

    writeFileSync(`./data/${binaryName}.zip`, binary?.rawBody);
    const zip = new AdmZip(`./data/${binaryName}.zip`);
    zip.extractAllTo("./data", true);

    unlinkSync(`./data/${binaryName}.zip`);

    const fileToMarkAsExec = afterExtractionName
      ? afterExtractionName
      : binaryName;

    if (platform === "win32") return;

    chmodSync(`./data/${fileToMarkAsExec}`, "755");
  }

  async downloadDepotDownloader(): Promise<void> {
    await this.getBinary("SteamRE/DepotDownloader", "DepotDownloader");
  }

  async downloadVRF(): Promise<void> {
    await this.getBinary(
      "ValveResourceFormat/ValveResourceFormat",
      "cli",
      "Source2Viewer-CLI",
    );
  }

  loadVPK(): void {
    this.vpkDir = new vpk(`${this.config.directory}/game/csgo/pak01_dir.vpk`);
    this.vpkDir.load();

    this.vpkStickerFiles = this.vpkDir.files.filter((f: string) =>
      f.startsWith(neededDirectories.stickers),
    );

    this.vpkPatchFiles = this.vpkDir.files.filter((f: string) =>
      f.startsWith(neededDirectories.patches),
    );

    this.vpkStatusIconFiles = this.vpkDir.files.filter((f: string) =>
      f.startsWith(neededDirectories.statusIcons),
    );

    this.weaponFiles = this.vpkDir.files.filter((f: string) =>
      f.startsWith(neededDirectories.weapons),
    );
  }

  getRequiredVPKFiles(): number[] {
    const requiredIndices: Record<string, boolean> = {};

    const dirs = Object.keys(neededDirectories)
      .filter((f) => !!this.config[f as keyof Config])
      .map((f) => neededDirectories[f]);

    for (const fileName of this.vpkDir.files) {
      if (
        dirs.some((dir) => fileName.startsWith(dir)) ||
        fileLookup[fileName]
      ) {
        const archiveIndex = this.vpkDir.tree[fileName].archiveIndex;
        if (!requiredIndices[archiveIndex]) {
          requiredIndices[archiveIndex] = true;
        }
      }
    }

    return Object.keys(requiredIndices)
      .map((i) => Number.parseInt(i))
      .sort((a, b) => a - b);
  }

  async downloadVPKFiles(): Promise<void> {
    this.log.debug("Computing required VPK files for selected packages");

    const requiredIndices = this.getRequiredVPKFiles();

    this.log.debug(`Downloading Required VPK files ${requiredIndices}`);

    const filesToDownload: { fileName: string; filePath: string }[] = [];

    for (const index of requiredIndices) {
      const archiveIndex = index;
      const paddedIndex =
        "0".repeat(3 - archiveIndex.toString().length) + archiveIndex;
      const fileName = `pak01_${paddedIndex}.vpk`;
      const filePath = `${this.config.directory}/${fileName}`;

      filesToDownload.push({ fileName: `game\\csgo\\${fileName}`, filePath });
    }

    writeFileSync(
      `${this.config.directory}/${this.config.fileList}-${pid}`,
      filesToDownload.map((f) => f.fileName).join("\n"),
    );

    await this.downloadFiles();

    unlinkSync(`${this.config.directory}/${this.config.fileList}-${pid}`);
  }

  async downloadFiles(): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(
        `./${this.config.directory}/${this.config.depotDownloader} -app ${APP_ID} -depot ${DEPOT_ID} -filelist ${this.config.directory}/${this.config.fileList}-${pid} -dir ${this.config.directory} -os windows -osarch 64 max-downloads 100 -max-servers 100 --validate`,
        (error, stdout) => {
          this.log.debug(stdout);
          if (error) {
            this.log.error("exec error:", error);
            reject();
          }

          resolve();
        },
      );
    });
  }
}

new Cs2CDN({
  logLevel: "debug",
});
