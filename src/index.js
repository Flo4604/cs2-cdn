import EventEmitter from "events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import vpk from "vpk";
import { exec } from "child_process";
import { HttpClient } from "@doctormckay/stdlib/http.js";
import AdmZip from "adm-zip";
import winston from "winston";
import os from "node:os";
import { pid } from "node:process";

const defaultConfig = {
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
  logLevel: "info",
  vrfBinary: "Decompiler",
  depotDownloader: "DepotDownloader",
  fileList: "filelist.txt",
};

const APP_ID = 730;
const DEPOT_ID = 2347770;

const ECON_PATH = "panorama/images/econ";

const neededDirectories = {
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
  setIcons: `${ECON_PATH}/set_icons`
};

const neededFiles = {
  itemsGame: "scripts/items/items_game.txt",
  csgoEnglish: "resource/csgo_english.txt",
};

const fileLookup = {};
Object.keys(neededFiles).forEach((key) => {
  fileLookup[neededFiles[key]] = 1;
});

class Cs2CDN extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = Object.assign(defaultConfig, config);

    this.createDataDirectory();

    this.client = new HttpClient({
      defaultHeaders: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
      },
    });

    this.log = winston.createLogger({
      level: config.logLevel,
      transports: [
        new winston.transports.Console({
          colorize: true,
          format: winston.format.printf((info) => {
            return `[cs2cdn.com] ${info.level}: ${info.message}`;
          }),
        }),
      ],
    });

    this.updateLoop();
  }

  /**
   * Creates the data directory specified in the config if it doesn't exist
   */
  createDataDirectory() {
    const dir = `./${this.config.directory}`;

    if (!existsSync(dir)) {
      mkdirSync(dir);
    }
  }

  /**
   * Runs the update loop at the specified config interval
   * @return {Promise<undefined>|void}
   */
  updateLoop() {
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

      // Try to load the resources locally
      try {
        this.loadVPK();
      } catch (e) {
        this.log.warn("Needed CS:GO files not installed");
        this.update();
      }
    }
  }

  /**
   * Retrieves and updates the sticker file directory from Valve
   *
   * Ensures that only the required VPK files are downloaded and that files with the same SHA1 aren't
   * redownloaded
   *
   * @return {Promise<void>}
   */
  async update() {
    this.log.info("Checking for CS:GO file updates");

    if (!existsSync(`${this.config.directory}/${this.config.vrfBinary}`)) {
      this.log.error(
        `VRF binary not found at ${this.config.vrfBinary}, downloading...`,
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

    const pathsToDump = Object.keys(neededDirectories)
      .filter((f) => this.config[f] === true)
      .map((f) => neededDirectories[f])
      .concat(Object.keys(neededFiles).map((f) => neededFiles[f]));

    // In CS:GO it was possible to just extract the image from the VPK, in CS2 this is not the case anymore
    // to work around this, we will still download all the required VPK's but then using https://github.com/ValveResourceFormat/ValveResourceFormat
    // we will extract the images from the VPK's directly and save them locally.
    // With that we can then use the images to generate the file path.
    await Promise.all(
      pathsToDump.map(
        (path) =>
          new Promise((resolve, reject) => {
            this.log.debug(`Dumping ${path}...`);
            exec(
              `${this.config.directory}/${this.config.vrfBinary} --input data/game/csgo/pak01_dir.vpk --vpk_filepath ${path} -o data -d > /dev/null`,
              (error) => {
                if (error) {
                  console.error(`exec error: ${error}`);
                }

                resolve();
              },
            );
          }),
      ),
    );

    this.log.info("Finished updating CS:GO files");

    // exit with success
    process.exit(0);
  }

  /**
   * Returns a platform-architecture string, or unknown if it can't be determined
   *
   * @returns {string} Platform-architecture string
   */
  getPlatform() {
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

  /**
   * By using the Github API request the latest tag from the given repository
   *
   * @param repository Repository to get the latest tag from
   *
   * @return {Promise<string>} Latest tag name
   */
  async getLatestGitTag(repository) {
    let latestTag = await this.client.request({
      method: "GET",
      url: `https://api.github.com/repos/${repository}/releases/latest`,
    });

    if (latestTag.statusCode !== 200) {
      throw new Error(`Failed to get latest release ${latestTag.statusCode}`);
    }

    return latestTag.jsonBody.tag_name;
  }

  /**
   * This function will download the latest binary from the given repository
   *
   * And extract the binary from the zip file and save it in the data directory
   *
   * @param repository Repository to get the latest binary from
   *
   * @param binaryName Name of the binary to download
   */
  async getBinary(repository, binaryName) {
    const latestTag = await this.getLatestGitTag(repository);
    const platform = this.getPlatform();

    let binary = await this.client.request({
      method: "GET",
      followRedirects: true,
      url: `https://github.com/${repository}/releases/download/${latestTag}/${binaryName}-${platform}.zip`,
    });

    if (binary.statusCode !== 200 && binary.statusCode !== 302) {
      throw new Error(`Failed to get latest release ${binary.statusCode}`);
    }

    writeFileSync(`./data/${binaryName}.zip`, binary.rawBody);
    const zip = new AdmZip(`./data/${binaryName}.zip`);
    zip.extractAllTo("./data", true);

    unlinkSync(`./data/${binaryName}.zip`);

    if (platform !== "win32") {
      chmodSync(`./data/${binaryName}`, "755");
    }
  }

  /**
   * Downloads the latest version of https://github.com/SteamRE/DepotDownloader
   */
  async downloadDepotDownloader() {
    await this.getBinary("SteamRE/DepotDownloader", "DepotDownloader");
  }

  /**
   * Downloads the latest version of https://github.com/ValveResourceFormat/ValveResourceFormat
   */
  async downloadVRF() {
    await this.getBinary(
      "ValveResourceFormat/ValveResourceFormat",
      "Decompiler",
    );
  }

  /**
   * Loads the CSGO dir VPK specified in the config
   */
  loadVPK() {
    this.vpkDir = new vpk(`${this.config.directory}/game/csgo/pak01_dir.vpk`);
    this.vpkDir.load();

    this.vpkStickerFiles = this.vpkDir.files.filter((f) =>
      f.startsWith(neededDirectories.stickers),
    );

    this.vpkPatchFiles = this.vpkDir.files.filter((f) =>
      f.startsWith(neededDirectories.patches),
    );

    this.vpkStatusIconFiles = this.vpkDir.files.filter((f) =>
      f.startsWith(neededDirectories.statusIcons),
    );

    this.weaponFiles = this.vpkDir.files.filter((f) =>
      f.startsWith(neededDirectories.weapons),
    );
  }

  /**
   * Given the CSGO VPK Directory, returns the necessary indices for the chosen options
   * @return {Array} Necessary Sticker VPK Indices
   */
  getRequiredVPKFiles() {
    const requiredIndices = {};

    const dirs = Object.keys(neededDirectories)
      .filter((f) => !!this.config[f])
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
      .map((i) => parseInt(i))
      .sort((a, b) => a < b);
  }

  /**
   * Downloads the required VPK files
   * @return {Promise<void>}
   */
  async downloadVPKFiles() {
    this.log.debug("Computing required VPK files for selected packages");

    const requiredIndices = this.getRequiredVPKFiles();

    this.log.debug(`Downloading Required VPK files ${requiredIndices}`);

    const filesToDownload = [];

    for (let index in requiredIndices) {
      index = parseInt(index);

      // pad to 3 zeroes
      const archiveIndex = requiredIndices[index];
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

  /**
   * Download the files from the filelist.txt via depotdownloader
   * @return {Promise<void>}
   */
  async downloadFiles() {
    return new Promise((resolve, reject) => {
      exec(
        `./${this.config.directory}/${this.config.depotDownloader} -app ${APP_ID} -depot ${DEPOT_ID} -filelist ${this.config.directory}/${this.config.fileList}-${pid} -dir ${this.config.directory} -os windows -osarch 64 max-downloads 100 -max-servers 100 --validate`,
        (error, stdout) => {
          this.log.debug(stdout);
          if (error) {
            console.error(`exec error: ${error}`);
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
