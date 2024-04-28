
const core = require("@actions/core")
const exec = require("@actions/exec")
const io = require("@actions/io")
const tc = require("@actions/tool-cache")
const fs = require("fs")
const fsp = fs
const path = require("path")

const BUILD_PREFIX = ".build-luarocks"

const LUA_PREFIX = ".lua" // default location for existing Lua installation
const LUAROCKS_PREFIX = ".luarocks" // default location for LuaRocks installation

const isWindows = () => (process.platform || "").startsWith("win32")

async function installWindows(luaRocksVersion, tempBuildPath, luaRocksInstallPath, luaPath) {
  const binaryZip = await tc.downloadTool(`https://luarocks.org/releases/luarocks-${luaRocksVersion}-win32.zip`)
  await tc.extractZip(binaryZip, tempBuildPath)

  const srcDir = path.join(tempBuildPath, `luarocks-${luaRocksVersion}-win32`)

  let luaVersion = ""
  await exec.exec(`lua -e "print(_VERSION:sub(5))"`, undefined, {
    listeners: {
      stdout: (data) => {
        luaVersion += data.toString()
      }
    }
  })
  if (!luaVersion) throw new Error("Lua version not found.");

  const dstDir = path.join(luaRocksInstallPath, "bin")
  await io.mkdirP(dstDir)
  const installBat = path.join(srcDir, `install.bat`)
  fs.chmodSync(installBat, '755');
  if (!fs.existsSync(installBat)) {
    core.setFailed(`install.bat does not exist at ${installBat}`);
    return;
  }

  core.info("Installing LuaRocks")
  const installExitCode = await exec.exec(installBat, [`/LV`, luaVersion, `/P`, dstDir, `/Q`, `/NOADMIN`], {
    listeners: {
      stdout: (data) => {
        core.info(data.toString());
      },
      stderr: (data) => {
        core.error(data.toString());
      }
    }
  })
  if (installExitCode !== 0) {
    core.setFailed(`install.bat failed with exit code ${installExitCode}`);
    return;
  }

  core.info("Done installing LuaRocks")

  core.info("Configuring LuaRocks")
  await exec.exec(`luarocks config lua_version ${luaVersion}`, undefined, {})

  /* fix for mingw without msvc; won't be needed from LuaRocks 3.9.2 onwards */
  if (!process.env["VCINSTALLDIR"]) {
    await exec.exec(`luarocks config variables.CC "x86_64-w64-mingw32-gcc"`, undefined, {})
    await exec.exec(`luarocks config variables.LD "x86_64-w64-mingw32-gcc"`, undefined, {})
  }
  core.info("Done configuring LuaRocks")
}

async function installUnix(luaRocksVersion, tempBuildPath, luaRocksInstallPath, luaPath) {
  const sourceTar = await tc.downloadTool(`https://luarocks.org/releases/luarocks-${luaRocksVersion}.tar.gz`)
  await tc.extractTar(sourceTar, path.join(tempBuildPath))

  const luaRocksExtractPath = path.join(tempBuildPath, `luarocks-${luaRocksVersion}`)

  const configureArgs = [
    `--with-lua="${luaPath}"`,
    `--prefix="${luaRocksInstallPath}"`
  ]

  await exec.exec(`./configure ${configureArgs.join(" ")}`, undefined, {
    cwd: luaRocksExtractPath
  })

  await exec.exec("make", undefined, {
    cwd: luaRocksExtractPath
  })

  // NOTE: make build step is only necessary for luarocks 2.x
  if (luaRocksVersion.match(/^2\./)) {
    await exec.exec("make build", undefined, {
      cwd: luaRocksExtractPath
    })
  }

  await exec.exec("make install", undefined, {
    cwd: luaRocksExtractPath
  })
}

async function main() {
  const luaRocksVersion = core.getInput('luaRocksVersion', { required: true })

  const luaRocksInstallPath = path.join(process.cwd(), LUAROCKS_PREFIX)

  const tempBuildPath = path.join(process.env["RUNNER_TEMP"], BUILD_PREFIX)
  await io.mkdirP(tempBuildPath)

  let luaPath = core.getInput("withLuaPath")
  if (!luaPath) {
    // NOTE: this is the default install path provided by gh-actions-lua
    luaPath = path.join(process.cwd(), LUA_PREFIX)
  }

  core.addPath(path.join(luaRocksInstallPath, "bin"));

  if (isWindows()) {
    await installWindows(luaRocksVersion, tempBuildPath, luaRocksInstallPath, luaPath);
  } else {
    await installUnix(luaRocksVersion, tempBuildPath, luaRocksInstallPath, luaPath);
  }

  // Update environment to use luarocks directly
  let lrBin = ""

  await exec.exec("luarocks path --lr-bin", undefined, {
    listeners: {
      stdout: (data) => {
        lrBin += data.toString()
      }
    }
  })

  await exec.exec("luarocks path --lr-bin", undefined, {
    listeners: {
      stdout: (data) => {
        lrBin += data.toString()
      }
    }
  })

  if (lrBin != "") {
    core.addPath(lrBin.trim());
  }

  let lrPath = ""

  await exec.exec("luarocks path --lr-path", undefined, {
    listeners: {
      stdout: (data) => {
        lrPath += data.toString()
      }
    }
  })

  lrPath = lrPath.trim()

  let lrCpath = ""

  await exec.exec("luarocks path --lr-cpath", undefined, {
    listeners: {
      stdout: (data) => {
        lrCpath += data.toString()
      }
    }
  })

  lrCpath = lrCpath.trim()

  if (lrPath != "") {
    core.exportVariable("LUA_PATH", ";;" + lrPath)
  }

  if (lrCpath != "") {
    core.exportVariable("LUA_CPATH", ";;" + lrCpath)
  }
}

main().catch(err => {
  core.setFailed(`Failed to install LuaRocks: ${err}`);
})

