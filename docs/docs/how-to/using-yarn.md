# Using Yarn

## What is Yarn?

[Yarn](https://yarnpkg.com/) is a package manager for JavaScript. It is used to manage and install dependencies for JavaScript projects, particularly for Node.js applications. Yarn offers features like parallel package installations and offline caching and uses a `yarn.lock` file to control and reproduce consistent installations of dependencies across different environments.

## Installing yarn

The official installation instructions can be found at https://yarnpkg.com/getting-started/install, but basically you have to first install Corepack, and let that manage yarn for you.

```bash
npm install --global corepack
```

## Using the correct version of yarn

To see the version of yarn that you have installed, run the following command:

```bash
yarn --version
```

**Redwood requires Yarn (>=1.22.21)**

You can upgrade your global yarn version by running the following command:

```bash
corepack install --global yarn@stable
```

If you want to upgrade the version of yarn that is used in your project these are the commands to use:

```bash
yarn set version stable
yarn install
```

:::info
If the `set version` command fails, you may need to [uninstall the current version of Yarn first](#uninstalling-yarn).

```terminal
corepack disable
npm uninstall -g yarn --force
npm install --global corepack
```

:::

## Installing packages and dependencies with yarn

You'll need to run `yarn install` in the root of your project directory to install all the necessary packages and dependencies for your project.

Redwood separates the backend (`api`) and frontend (`web`) concerns into their own paths in the codebase. ([Yarn refers to these as "workspaces"](https://yarnpkg.com/features/workspaces). In Cedar, we refer to them as "sides.") When you add packages going forward you'll need to specify which workspace they should go in.

For example to install a package on the `web` or **frontend** side, you would run the following command:

```bash
yarn workspace web add package-name
```

and to install a package on the `api` or **backend** side, you would run the following command:

```bash
yarn workspace api add package-name
```

## Uninstalling yarn

To uninstall yarn, run the following command:

```bash
corepack disable
npm uninstall -g yarn --force
```

## Additional Information

For additional information, you can refer directly to the [yarn documentation](https://yarnpkg.com/).
