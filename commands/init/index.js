const fs = require("fs-extra");
const path = require("path");
const paths = require("../../helper/paths");
const pm = require("../../helper/pm");
const logger = require("../../helper/logger");
const format = require("../../helper/format-unicorn");
const getLicense = require("./get-license");
const build = require("../build");
const myPackageJson = require("../../package.json");

const bootstrap = (app) => {
  app
    .command("init", "Creates a new react library")
    .option("-Y --yes", "Skip package.json creation questions.")
    .option("-D --dependency <dependency>", "Decides on how to add create-react-prototype as a dependency. (Possible values: npm/local/retain/none)")
    .option("-P --packageManager <packageManager>", "The package manager to use. (Possible values: npm/yarn)")
    .option("--debug", "Activates debug output for this command")
    .option("--noExample", "Opt out of creating an example project.")
    .option("--noStorybook", "Opt out of creating a storybook project.")
    .action(async (args, callback) => {
      // Set default options
      process.env.NODE_ENV = process.env.NODE_ENV || "development";
      args.options.dependency = args.options.dependency || "npm";
      args.options.packageManager = args.options.packageManager || "npm";
      args.options.noExample = !!args.options.noExample;
      args.options.noStorybook = !!args.options.noStorybook;
      args.options.yes = !!args.options.yes;
      args.options.debug = !!args.options.debug;
      logger.setDebug(args.options.debug);

      logger(logger.DEBUG, "NODE_ENV:", process.env.NODE_ENV);
      logger(logger.DEBUG, "Options:", args.options);

      logger(logger.INFO, "Welcome to create-react-prototype. Let's get started with setting up your package.json ...");
      logger(logger.INFO, "Tip: Fill it out properly, we'll read it and assume you entered correct data!");
      if (args.options.yes) {
        logger(logger.WARNING, "The '--yes' flag has been set. This will skip the package.json questions, which has possible security implications.");
      }
      await pm.init({ yes: args.options.yes }, args.options.packageManager);

      logger(logger.INFO, "Nice! Now we'll shove some of our configuration into your package.json ...");
      await adjustPackageJson(args.options);

      logger(logger.INFO, "We will now set up your project with some default files ...");
      await copyScaffolding(args.options);

      logger(logger.INFO, "Installing library ...");
      await pm.install({ dir: paths.getProjectFolder() });

      logger(logger.INFO, "Creating initial build ...");
      await build.runFullBuild();

      if (await fs.exists(paths.getExampleFolder())) {
        logger(logger.INFO, "Installing example ...");
        await pm.install({ dir: paths.getExampleFolder() });
      }

      if (await fs.exists(paths.getStorybookFolder())) {
        logger(logger.INFO, "Installing storybook ...");
        await pm.install({ dir: paths.getStorybookFolder() });
      }

      logger(logger.SUCCESS, "Created a new React library in '" + paths.getProjectFolder() + "' -- Happy coding!")
      callback();
    });
};

const adjustPackageJson = async (options = {}) => {
  const packageJsonPath = path.join(paths.getProjectFolder(), "./package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath));

  let myDependency;
  switch (options.dependency) {
    case "npm": {
      myDependency = "^" + myPackageJson.version;
      break;
    }
    case "local": {
      const filePath = path.relative(paths.getProjectFolder(), paths.getMyFolder());
      myDependency = await pm.linkString({ dir: filePath });
      break;
    }
    case "tgz": {
      const fullFilePath = await pm.pack({dir: paths.getMyFolder(), outputDir: paths.getMyFolder(), pkg: myPackageJson}, options.packageManager);
      const filePath = path.relative(paths.getProjectFolder(), fullFilePath);
      myDependency = filePath;
      break;
    }
    case "none": {
      myDependency = undefined;
      break;
    }
    case "retain": {
      myDependency = packageJson.devDependencies && packageJson.devDependencies["create-react-prototype"];
      break;
    }
    default: {
      if (options.dependency.startsWith("npm@")) {
        myDependency = options.dependency.substring("npm@".length);
      } else {
        throw new Error(`Unknown dependency mode '${options.dependency}'.`);
      }
    }
  }

  // Update the JSON
  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts["build"] = "create-react-prototype build";
  packageJson.scripts["watch"] = "create-react-prototype watch";
  packageJson.scripts["test"] = "create-react-prototype test";
  packageJson.scripts["release"] = "create-react-prototype release";
  packageJson.scripts["pack"] = "create-react-prototype pack";
  packageJson.generator = "create-react-prototype";
  packageJson.packageManager = options.packageManager;
  packageJson.main = "./src/index.js";

  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.dependencies["@babel/runtime"] = packageJson.dependencies["@babel/runtime"] || "^7.0.0-rc.1";

  packageJson.devDependencies = packageJson.devDependencies || {};
  packageJson.devDependencies["create-react-prototype"] = myDependency;
  packageJson.devDependencies["react"] = packageJson.devDependencies["react"] || "^16.2.0"
  packageJson.devDependencies["react-dom"] = packageJson.devDependencies["react-dom"] || "^16.2.0"

  packageJson.peerDependencies = packageJson.peerDependencies || {};
  packageJson.peerDependencies["react"] = packageJson.peerDependencies["react"] || ">=16.2.0"
  packageJson.peerDependencies["react-dom"] = packageJson.peerDependencies["react-dom"] || ">=16.2.0"

  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
};

const getFileArgs = async () => {
  const packageJsonPath = path.join(paths.getProjectFolder(), "./package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath));
  const year = new Date().getFullYear();
  const { description, name, version, license, author: fullname } = packageJson;
  const linkStr = await pm.linkString({ dir: path.relative(paths.getSourceFolder(), paths.getDistFolder()) });
  // Create the basic options
  const obj = {
    description, name, version, year, license, fullname,
    "link:dist": linkStr
  };
  // Create a JSON escaped version of each string
  return Object.keys(obj).reduce((acc, key) => {
    // Yarn intializes some variables with undefined if --yes is used.
    acc[key] = acc[key] !== undefined ? acc[key] : "";
    acc[key + "/json"] = acc[key] !== undefined ? JSON.stringify(acc[key]).replace(/^"(.*)"$/, '$1') : "";
    return acc;
  }, obj);
};

const copyScaffolding = async ({ noExample, noStorybook } = {}) => {
  const args = await getFileArgs();
  await createLicense(args);
  await createGitignore(args);
  await copyFile("./README.md", args);
  await copyFile("./CHANGELOG.md", args);
  if (!noExample) await copyExample(args);
  if (!noStorybook) await copyStorybook(args);
  await copySrc(args);
};

const copySrc = async (args) => {
  if (await fs.exists(paths.getSourceFolder())) {
    logger(logger.WARNING, "Source directory already exists, not copying demo code.");
  } else {
    const sourceRelativePath = path.relative(paths.getProjectFolder(), paths.getSourceFolder());
    await copyDirectory(sourceRelativePath, args);
  }
}

const copyExample = async (args) => {
  if (await fs.exists(paths.getExampleFolder())) {
    logger(logger.WARNING, "Example directory already exists, not copying examples.");
  } else {
    const exampleRelativePath = path.relative(paths.getProjectFolder(), paths.getExampleFolder());
    await copyDirectory(exampleRelativePath, args);
  }
}

const copyStorybook = async (args) => {
  if (await fs.exists(paths.getStorybookFolder())) {
    logger(logger.WARNING, "Storybook directory already exists, not copying storybook.");
  } else {
    const storyRelativePath = path.relative(paths.getProjectFolder(), paths.getStorybookFolder());
    await copyDirectory(storyRelativePath, args);
  }
}

const createLicense = async (args) => {
  let licenseText;
  try {
    licenseText = await getLicense(args.license);
  } catch (_) {
    logger(logger.WARNING, "Could not get license text for license '" + args.license + "'. Make sure to manually update your LICENSE file!");
    licenseText = (await fs.readFile(path.join(__dirname, "./LICENSE"))).toString();
  }
  licenseText = format(licenseText, args);
  logger(logger.TRACE, "Created:", "./LICENSE");
  await fs.writeFile(path.join(paths.getProjectFolder(), "./LICENSE"), licenseText);
};

const createGitignore = async (args) => {
  const srcFilePath = path.join(paths.getProjectFolder(), ".gitignore");
  if (!await fs.exists(srcFilePath)) {
    logger(logger.TRACE, "Created:", "./.gitignore");
    await fs.writeFile(srcFilePath, format(`# Default create-react-prototype .gitignore for [name]
node_modules/
dist/
*.tgz
`, args));
  }
}

const copyFile = async (file, args) => {
  const srcFilePath = path.join(paths.getProjectFolder(), file);
  if (!await fs.exists(srcFilePath)) {
    const filePath = path.join(__dirname, file);
    const contents = (await fs.readFile(filePath)).toString();
    const formatted = format(contents, args);
    logger(logger.TRACE, "Created:", file);
    await fs.writeFile(srcFilePath, formatted);
  }
};

const copyDirectory = async (dir, args) => {
  const srcDir = path.join(paths.getProjectFolder(), dir);
  if (!await fs.exists(srcDir)) {
    await fs.mkdir(srcDir);
  }
  const contents = await fs.readdir(path.join(__dirname, dir));
  const promises = contents.map(async content => {
    const stats = await fs.lstat(path.join(__dirname, dir, content));
    const rel = path.join(dir, content);
    if (stats.isDirectory()) {
      await copyDirectory(rel, args);
    } else {
      await copyFile(rel, args);
    }
  });
  await Promise.all(promises);
};

module.exports = {
  bootstrap
};
