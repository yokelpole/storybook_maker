import { createInterface, Interface } from "node:readline";
import { exec, ChildProcess } from "child_process";
import { writeFile, readFile, access } from "node:fs/promises";
import { argv } from "node:process";
import terminate from "terminate";
import { getTemplate } from "./template/templateGenerator";
import sharp from "sharp";
import { StoryMetadata, StoryPage } from "./types";
import { WebUiManager } from "./WebUiManager";
import {
  getStableDiffusionImages,
  getUpscaledStableDiffusionImages,
} from "./apis";

// Script to edit a created story - allows for the user to choose the best images for the story.

async function chooseImage({
  iface,
  editedPath,
  targetImage,
  storyPage,
  metadata,
}: {
  iface: Interface;
  editedPath: string;
  targetImage: string;
  storyPage: StoryPage;
  metadata: StoryMetadata;
}): Promise<number> {
  let imageProcess: ChildProcess = exec(
    `/usr/bin/display ${process.cwd()}/${editedPath}/${targetImage}-0.png`
  );
  let imageNumber: number = null;
  let retry: boolean = false;

  iface.on("line", (answer) => {
    const trimmed = answer.trim();

    if (trimmed === "retry") retry = true;
    if (Number.isNaN(trimmed)) return;

    imageNumber = parseInt(trimmed);
  });

  while (!imageNumber) {
    await new Promise((resolve) => setTimeout(resolve, 250));

    if (retry) {
      const newImages = await getStableDiffusionImages({
        height: metadata.height,
        width: metadata.width,
        prompt: metadata.prompt,
        sampler: metadata.sampler,
        storyPage,
        steps: metadata.steps,
        useRegions: !!(storyPage.heroPrompt && storyPage.supportPrompt),
      });

      for (const [imageIndex, image] of newImages.entries()) {
        await writeFile(
          `${process.cwd()}/${editedPath}/${targetImage}-${imageIndex}.png`,
          Buffer.from(image as string, "base64")
        );
      }

      terminate(imageProcess.pid, "SIGKILL");
      imageProcess = exec(
        `/usr/bin/display ${process.cwd()}/${editedPath}/${targetImage}-0.png`
      );
      retry = false;
    }
  }

  terminate(imageProcess.pid, "SIGKILL");

  return imageNumber;
}

async function editStory() {
  const path = argv[2];
  await access(path);
  const editedPath = path.replace("./", "");
  const chosenImages: number[] = [];

  // Prompt the user to choose the best images for the story.
  const iface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // FIXME: Might be good to see if stable diffusion is already running.
  const webUi = new WebUiManager();

  const [_, storyFile, metadataFile] = await Promise.all([
    webUi.startProcess(),
    await readFile(`./${editedPath}/story.json`, "utf-8"),
    await readFile(`./${editedPath}/metadata.json`, "utf-8"),
  ]);

  const story: StoryPage[] = JSON.parse(storyFile);
  const metadata: StoryMetadata = JSON.parse(metadataFile);

  console.log("Title Page: ", metadata.titlePageStoryPage);
  const chosenTitlePageImage = await chooseImage({
    iface,
    editedPath,
    targetImage: "title",
    storyPage: metadata.titlePageStoryPage,
    metadata,
  });

  for (const [index, storyPage] of story.entries()) {
    console.log("Story Page: ", storyPage);

    chosenImages.push(
      await chooseImage({
        iface,
        editedPath,
        targetImage: index.toString(),
        storyPage,
        metadata,
      })
    );
  }

  iface.close();

  const common = {
    width: Number(metadata.width),
    height: Number(metadata.height),
    prompt: metadata.prompt,
    steps: metadata.steps,
    sampler: metadata.sampler,
  };

  const upscaledTitlePageImage = (
    await getUpscaledStableDiffusionImages({
      ...common,
      images: [
        (
          await readFile(`./${editedPath}/title-${chosenTitlePageImage}.png`)
        ).toString("base64"),
      ],
      storyPages: [metadata.titlePageStoryPage],
    })
  )[0];

  const upscaledImages = await getUpscaledStableDiffusionImages({
    ...common,
    images: await Promise.all(
      chosenImages.map(async (imageNumber, index) =>
        (
          await readFile(`./${editedPath}/${index}-${imageNumber}.png`)
        ).toString("base64")
      )
    ),
    storyPages: story,
  });

  await webUi.stopProcess();

  await sharp(Buffer.from(upscaledTitlePageImage, "base64"))
    .jpeg({ quality: 98 })
    .toFile(`./${editedPath}/title.jpg`);

  await Promise.all(
    upscaledImages.map((image, index) =>
      sharp(Buffer.from(image, "base64"))
        .jpeg({ quality: 98 })
        .toFile(`./${editedPath}/final-${index}.jpg`)
    )
  );

  await writeFile(
    `./${editedPath}/index.html`,
    getTemplate({
      pages: story,
      isEdited: true,
      hero: metadata.hero,
      title: metadata.titlePageStoryPage.paragraph,
      support: metadata.support,
    })
  );
}

editStory();
