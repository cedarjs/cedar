---
title: Contributing Walkthrough
description: Watch a video of the contributing process
---

# Contributing: Step-by-Step Walkthrough (with Video)

> ⚡️ **Quick Links**
>
> There are several contributing docs and references, each covering specific topics:
>
> 1. 🧭 [Overview and Orientation](contributing-overview.md)
> 2. 📓 [Reference: Contributing to the Framework Packages](https://github.com/cedarjs/cedar/blob/main/CONTRIBUTING.md)
> 3. 🪜 **Step-by-step Walkthrough** (👈 you are here)
> 4. 📈 [Current Project Status: v1 Release Board](https://github.com/orgs/redwoodjs/projects/6)
> 5. 🤔 What should I work on?
>    - ["Help Wanted" v1 Triage Board](https://redwoodjs.com/good-first-issue)
>    - [Discovery Process and Open Issues](contributing-overview.md#what-should-i-work-on)

## Video Recording of Complete Contributing Process

The following recording is from a Contributing Workshop, following through the exact steps outlined below. The Workshop includes additional topics along with Q&A discussion.

<iframe
  class="w-full"
  style={{ height: '24rem' }}
  src="https://www.youtube.com/embed/aZs_9g-5Ms8"
  frameborder="0"
  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; modestbranding; showinfo=0; fullscreen"
></iframe>

## Prologue: Getting Started with Cedar and GitHub (and git)

These are the foundations for contributing, which you should be familiar with before starting the walkthrough.

[**The Cedar Tutorial**](tutorial/foreword.md)

The best (and most fun) way to learn Cedar and the underlying tools and technologies.

**Docs and How To**

- Start with the [Introduction](https://github.com/cedarjs/cedar/blob/main/README.md) Doc
- And browse through [How To's](how-to)

### GitHub (and Git)

Diving into Git and the GitHub workflow can feel intimidating if you haven’t experienced it before. The good news is there’s a lot of great material to help you learn and be committing in no time!

- [Introduction to GitHub](https://lab.github.com/githubtraining/introduction-to-github) (overview of concepts and workflow)
- [First Day on GitHub](https://lab.github.com/githubtraining/first-day-on-github) (including Git)
- [First Week on GitHub](https://lab.github.com/githubtraining/first-week-on-github) (parts 3 and 4 might be helpful)

## The Full Workflow: From Local Development to a New PR

### Definitions

#### Cedar “Project”

We refer to the codebase of a Cedar application as a Project. This is what you install when you run `yarn create cedar-app <path-to-directory>`. It’s the thing you are building with Cedar.

Lastly, you’ll find the template used to create a new project (when you run create cedar-app) here in GitHub: [cedarjs/cedar/packages/create-cedar-app/template/](https://github.com/cedarjs/cedar/tree/main/packages/create-cedar-app/template)

We refer to this as the **CRWA Template or Project Template**.

#### Cedar “Framework”

The Framework is the codebase containing all the packages (and other code) that is published on NPMjs.com as `@cedarjs/<package-name>`. The Framework repository on GitHub is here: [https://github.com/cedarjs/cedar](https://github.com/cedarjs/cedar)

### Development tools

These are the tools used and recommended by the Core Team.

**VS Code**
[Download VS Code](https://code.visualstudio.com/download)
This has quickly become the de facto editor for JavaScript and TypeScript. Additionally, we have added recommended VS Code Extensions to use when developing both the Framework and a Project. You’ll see a pop-up window asking you about installing the extensions when you open up the code.

**GitHub Desktop**
[Download GitHub Desktop](https://desktop.github.com)
You’ll need to be comfortable using Git at the command line. But the thing we like best about GitHub Desktop is how easy it makes workflow across GitHub -- GitHub Desktop -- VS Code. You don’t have to worry about syncing permissions or finding things. You can start from a repo on GitHub.com and use Desktop to do everything from “clone and open on your computer” to returning back to the site to “open a PR on GitHub”.

**[Mac OS] iTerm and Oh-My-Zsh**
There’s nothing wrong with Terminal (on Mac) and plain zsh or bash. (If you’re on Windows, we highly recommend using Git for Windows and Git bash.) But we enjoy using iTerm2 ([download](https://iterm2.com)) and zsh much more (combined with [Oh My Zsh](https://ohmyz.sh)). Heads up, you can get lost in the world of theming and adding plugins. We recommend keeping it simple for awhile before taking the customization deep dive
😉.

**[Windows] Git for Windows with Git Bash or WSL(2)**
Unfortunately, there are a lot of “gotchas” when it comes to working with Javascript-based frameworks on Windows. We do our best to point out (and resolve) issues, but our priority focus is on developing a Cedar app vs contributing to the Framework. (If you’re interested, there’s a lengthy Forum conversation about this with many suggestions.)

All that said, we highly recommend using one of the following setups to maximize your workflow:

1. Use [Git for Windows and Git Bash](how-to/windows-development-setup.md) (included in installation)
2. Use [WSL following this setup guide on the Forums](https://community.redwoodjs.com/t/windows-subsystem-for-linux-setup/2439)

Lastly, the new Gitpod integration is a great option and only getting better. You might just want to start using it from the beginning (see section below in “Local Development Setup”).

**Gitpod**
We recently added an integration with [Gitpod](http://gitpod.io) that automatically creates a Framework dev workspace, complete with test project, in a browser-based VS Code environment. It’s pretty amazing and we highly recommend giving it a shot. (If you’re developing on Windows, it’s also an amazing option for you anytime you run into something that isn’t working correctly or supported.)

But don’t skip out reading the following steps in “Local Development Setup” — Gitpod uses the same workflow and tools to initialize. If you want to develop in Gitpod, you’ll need to understand how it all works.

But when you’re ready, learn how to use it in the section at the end [“GitPod: Browser-based Development”](#gitpod-browser-based-development).

### Local Development Setup

#### Step 1: Cedar Framework

1. **Fork the [Cedar Framework](https://github.com/cedarjs/cedar)** into a personal repo
2. Using GitHub Desktop, **open the Framework Codebase** in a VS Code workspace
3. Commands to “**start fresh**” when working on the Framework
   - `yarn install`: This installs the package dependencies in /node_modules using Yarn package manager. This command is the same as just typing `yarn`. Also, if you ever switch branches and want to make sure the install dependencies are correct, you can run `yarn install --force` (shorthand `yarn -f`).
   - `git clean -fxd`: _You’ll only need to do this if you’ve already been developing and want to “start over” and reset your codebase_. This command will permanently delete everything that is .gitignored, e.g. /node_modules and /dist directories with package builds. When switching between branches, this command makes sure nothing is carried over that you don’t want. (Warning: it will delete .env files in a Cedar Project. To avoid this, you can use `git clean -fxd -e .env`.)
4. **Create a new branch** from the `main` branch
   First make sure you’ve pulled all changes from the remote origin (GitHub repo) into your local branch. (If you just cloned from your fork, you should be up to date.) Then create a new branch. The nomenclature used by David Price is `<davids_initials>-description-with-hyphens`, e.g. `dsp-add-eslint-config-redwood-toml`. It's simple to use VS Code or GitHub Desktop to manage branches. You can also do this via the CLI git checkout command.

#### Step 2: Test Project

There are several options for creating a local Cedar Project to use during development. Anytime you are developing against a test project, there are some specific gotchas to keep in mind:

- New projects always use the latest stable version of the Cedar packages, which will not be up to date with the latest Framework code in the `main` branch.
- To use the packages corresponding with the latest code in the Framework `main` branch, you can use the canary version published to NPM. All you need to do to install the canary versions is run `yarn rw upgrade --tag canary` in your Project
- Using a cloned project or repo? Just know there are likely breaking changes in `main` that haven’t been applied. You can examine merged PRs with the “breaking” label for more info.
- Just because you are using canary doesn’t mean you are using your local Framework branch code! Make sure you run `yarn cfw project:sync`. And anytime you switch branches or get out of sync, you might need to start over beginning with the `git clean -fxd` command

With those details out of the way, now is the time to choose an option below that meets your needs based on functionality and codebase version.

**Build a Functional Test Project [Recommended]**

1. 👉 **Use the build script to create a test project**: From the Framework root directory, run `yarn build:test-project <path/to/directory>`. This command installs a new project using the Template codebase from your current Framework branch, it then adds Tutorial features, and finally it initializes the DB (with seed data!). It should work 90% of the time and is the recommended starting place. We also use this out-of-the-box with Gitpod.

**Other Options to create a project**

2. **Install a fresh project using the local Framework template code:** Sometimes you need to create a project that uses the Template codebase in your local branch of the Framework, e.g. your changes include modifications to the CRWA Template and need to be tested. Running the command above is exactly the same as `yarn create cedar-app …`, only it runs the command from your local Framework package using the local Template codebase. Note: this is the same command used at the start of the `yarn build:test-project` command.

```
yarn babel-node packages/create-cedar-app/src/create-cedar-app.js <path/to/project>
```

3. **Clone the Cedar Tutorial App repo:** This is the codebase to use when starting the Cedar Tutorial Part 2. It is updated to the latest version and has the Blog features. This is often something we use for local development. Note: be sure to upgrade to canary and look out for breaking changes coming with the next release.

4. **Install a fresh project**: `yarn create cedar-app <path/to/project>` If you just need a fresh installation 1) using the latest version template codebase and 2) without any features, then just install a new Cedar project. Note: this can have the same issues regarding the need to upgrade to canary and addressing breaking changes (see Notes from items 2 and 3 above).

> Note: All the options above currently set the language to JavaScript. If you would like to work with TypeScript, you can add the option `--typescript` to either of the commands that run the create-cedar-app installation.

#### Step 3: Link the local Framework with the local test Project

Once you work on the Framework code, you’ll most often want to run the code in a Cedar app for testing. However, the Cedar Project you created for testing is currently using the latest version (or canary) packages of Cedar published on NPMjs.com, e.g. [@cedarjs/core](https://www.npmjs.com/package/@cedarjs/core)

So we’ll use the Cedar Framework (cfw) command to connect our local Framework and test Projects, which allows the Project to run on the code for Packages we are currently developing.

Run this command from the CLI in your test Project:

```
CFW_PATH=<framework directory> yarn cfw project:sync
```

For Example:

```
cd cedar-project
CFW_PATH=~/cedar yarn cfw project:sync
```

`CFW_PATH` is the path to your local copy of the Cedar Framework. _Once provided to cfw, it'll remember it and you shouldn't have to provide it again unless you move it._

> **Heads up for Windows Devs**
> Depending on your dev setup, Windows might balk at you setting the env var CFW_PATH at the beginning of the command like this. If so, try prepending with `cross-env`, e.g. `yarn cross-env CFW_PATH=~/cedar yarn cfw` ... Or you can add the env var and value directly to your shell before running the command.

As project:sync starts up, it'll start logging to the console. In order, it:

1. cleans and builds the framework
2. copies the framework's dependencies to your project
3. runs yarn install in your project
4. copies over the framework's packages to your project
5. waits for changes

Step two is the only explicit change you'll see to your project. You'll see that a ton of packages have been added to your project's root package.json.

All done? You’re ready to kill the link process with “ctrl + c”. You’ll need to confirm your root package.json no longer has the added dependencies. And, if you want to reset your test-project, you should run `yarn install --force`.

#### Step 4: Framework Package(s) Local Testing

Within your Framework directory, use the following tools and commands to test your code:

1. **Build the packages**: `yarn build`
   - to delete all previous build directories: yarn build:clean
2. **Syntax and Formatting**: `yarn lint`
   - to fix errors or warnings: `yarn lint:fix`
3. **Run unit tests for each package**: `yarn test`
4. **Run through the Cypress E2E integration tests**: `yarn e2e`
5. **Check Yarn resolutions and package.json format**: `yarn check`

All of these checks are included in Cedar’s GitHub PR Continuous Integration (CI) automation. However, it’s good practice to understand what they do by using them locally. The E2E tests aren’t something we use every time anymore (because it takes a while), but you should learn how to use it because it comes in handy when your code is failing tests on GitHub and you need to diagnose.

> **Heads up for Windows Devs**
> The Cypress E2E does _not_ work on Windows. Two options are available if needed:
>
> 1. Use Gitpod (see related section for info)
> 2. When you create a PR, just ask for help from a maintainer

#### Step 5: Open a PR 🚀

You’ve made it to the fun part! It’s time to use the code you’re working on to create a new PR into the Cedar Framework `main` branch.

We use GitHub Desktop to walk through the process of:

- Committing my changes to my development branch
- Publishing (pushing) my branch and changes to my GitHub repo fork of the Cedar Framework
- Opening a PR requesting to merge my forked-repo branch into the Cedar Framework `main` branch

> While we use GitHub Desktop as an example, the basic process outlined above is the same whether using the command line or other clients.

1. **Commit Files:** Using GitHub Desktop, browse to your local Cedar Framework repository and select the current branch you're working on. On the left-hand side, you'll see the files that have been modified, added, or removed. Check the boxes for the files you want to include in the PR. Below the file list, you'll see two text boxes and a "Commit to &lt;your-branch-name&gt;" button. Write a short commit message in the first box. If you want to add a longer description then you can do so in the second box. Click the "Commit to ..." button to commit the changes to the branch. The files are now committed under that commit message.

2. **Push Files:** After committing, you should see an option appear with the count of local commits and a button to "Push origin." If you're ready to push those changes to the remote branch, click that button. Otherwise, you can keep working and add more commits using the process in step 1.

3. **Create Pull Request:** Once the commit(s) have been pushed, you should see another option for "Create Pull Request." This will open a browser window to GitHub's "Open a pull request" form. Fill out the appropriate information, check the box to "Allow edits by maintainers," and submit!

> If you are following along and are not using GitHub Desktop, after pushing your commits, you can open a pull request by visiting [github.com](https://github.com) and browsing to your fork. There should be a button at the top to submit a pull request.

You have successfully submitted your PR!

**Note:** Make sure you check the box that allows project maintainers to update your branch. This option is found on the "Open a pull request" form below the description textbox. Checking this option helps move a PR forward more quickly, as branches always need to be updated from `main` before we can merge.

**When is my code “ready” to open a PR?**
Most of the action, communication, and decisions happen within a PR. A common mistake new contributors make is _waiting_ until their code is “perfect” before opening a PR. Assuming your PR has some code changes, it’s great practice to open a [Draft PR](https://github.blog/2019-02-14-introducing-draft-pull-requests/) (setting during the PR creation), which you can use to start discussion and ask questions. PRs are closed all the time without being merged, often because they are replaced by another PR resulting from decisions and discussion. It’s part of the process. More importantly, it means collaboration is happening!

What isn’t a fun experience is spending a whole bunch of time on code that ends up not being the correct direction or is unnecessary/redundant to something that already exists. This is a part of the learning process. But it’s another reason to open a draft PR sooner than later to get confirmation and questions out of the way before investing time into refining and details.

When in doubt, just try first and ask for help and direction!

Refer to the [What makes for a good Pull Request?](contributing-overview.md#what-makes-for-a-good-pull-request) section in [Contributing Overview](contributing-overview.md)for general good practices when opening PR.

### Gitpod: Browser-based Development

> ⚠️
> ⚠️ These Gitpod instructions are old, and not officially supported.
> ⚠️ Gitpod is now known as Ona (https://ona.com)
> ⚠️ If you do get Gitpod/Ona working, please update this section.
> ⚠️

[Gitpod](http://gitpod.io) has recently been integrated with Cedar to JustWork™ with any branch or PR. When a virtual Gitpod workspace is initialized, it automatically:

1. Checks-out the code from your branch or PR
2. Run Yarn installation
3. Creates the functional Test Project via `yarn build:test-project`
4. Syncs the Framework code with the Test Project
5. Starts the Test Project dev server
6. 🤯

> **Chrome works best**
> We’ve noticed some bugs using Gitpod with either Brave or Safari. Currently we recommend sticking to Chrome (although it’s worth trying out Edge and Firefox).

**Demo of Gitpod**
David briefly walks-through an automatically prebuilt Gitpod workspace here:

- [Gitpod + CedarJS 3-minute Walkthrough](https://youtu.be/_kMuTW3x--s)

Make sure you watch until the end where David shows how to set up your integration with GitHub and VS Code sync. 🤩

**Start a Gitpod Workspace**
There are two ways to get started with Gitpod + Cedar.

_Option 1: Open a PR_
Every PR will trigger a Gitpod prebuild using the PR branch. Just look for Gitpod in the list of checks at the bottom of the PR — click the “Details” link and away you’ll go!

<img
  width="350"
  alt="PR Checks"
  src="https://user-images.githubusercontent.com/2951/151928088-58e26232-b752-4471-adf4-a2bc59b79ac8.png"
/>

_Option 2: Use the link from your project or branch_

You can initialize a workspace using this URL pattern:

```
https://gitpod.io/#<URL for branch or project>
```

For example, this link will start a workspace using the CedarJS main branch:

- https://gitpod.io/#https://github.com/cedarjs/cedar

And this link will start a workspace for a PR #767:

- https://gitpod.io/#https://github.com/cedarjs/cedar/pull/767
