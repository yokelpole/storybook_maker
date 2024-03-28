"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const commander_1 = require("commander");
const apis_1 = require("./apis");
const templateGenerator_1 = require("./template/templateGenerator");
const WebUiManager_1 = require("./WebUiManager");
const storyMaker_1 = require("./storyMaker");
commander_1.program
    .option("-m, --model <model>", "ollama model to use", "mistral")
    /*
      List:
        - cyberrealistic_classicV31, dreamshaper_8, LZ-16K+Optics, realismEngine_v10
        - v1-5-pruned
    */
    .option("-msd, --modelStableDiffusion <model>", "stable diffusion model to use", "dreamshaper_8")
    .option("-g, --genre <title>", "genre of the story", "children's story")
    .option("-p, --storyPlot <prompt>", "suggested plot for the hero of the story", "")
    .option("-h, --hero <name>", "name of the protagonist", "Gavin")
    .option("-hg, --heroGender <male|female>", "gender of the protagonist", "male")
    .option("-htags, --heroTags <description>", "tag based description of the protagonist for rendering", "toddler")
    .option("-hd, --heroDescription <description>", "description of the protagonist for the story", "a boy toddler")
    .option("-sh, --support <name>", "name of the supporting character", "")
    .option("-sg, --supportGender <male|female>", "gender of the supporting character", "")
    .option("-stags, --supportTags <description>", "tag based description of the supporting character for rendering", "")
    .option("-sd, --supportDescription <description>", "description of the supporting character for the story", "")
    .option("-l, --lora <lora>", "lora to use for the hero", "gavin-15")
    .option("-sl, --supportLora <name>", "lora to use for the supporting character", "")
    .option("-pg, --pages <page>", "number of pages to generate", "5")
    .option("-pr, --prompt <prompt>", `additional details to provide to the prompt - should just specify what the overall image looks like`, "8k, high resolution, high quality")
    .option("-s, --sampler <sampler>", "sampler to use", "DPM++ 2M Karras")
    .option("-st, --steps <steps>", "number of steps to use in rendering", "40")
    .option("-x, --width <width>", "width of the image", "512")
    .option("-y, --height <height>", "height of the image", "512")
    .parse();
async function makeStory() {
    const opts = commander_1.program.opts();
    console.log("Options: ", opts);
    const { model, modelStableDiffusion, genre, storyPlot, hero, heroGender, heroDescription, heroTags: inputHeroTags, support, supportGender, supportDescription, supportTags: inputSupportTags, lora, supportLora, pages, prompt, sampler, steps, width, height, } = commander_1.program.opts();
    const heroTags = `${heroGender}, ${inputHeroTags}`;
    const supportTags = `${supportGender}, ${inputSupportTags}`;
    // Ensure that the targeted lora exists. Saves us time if something went wrong.
    await (0, promises_1.access)(`/home/kyle/Development/stable_diffusion/stable-diffusion-webui/models/Lora/${lora}.safetensors`);
    const directoryPath = Math.floor(Date.now() / 1000).toString();
    await (0, promises_1.mkdir)(`./stories/${directoryPath}`, { recursive: true });
    const { story, title, characterDescriptionMap, ollamaContext } = await (0, storyMaker_1.createStory)({
        genre,
        storyPlot,
        hero,
        heroDescription,
        heroTags,
        support,
        supportDescription,
        supportTags,
        supportLora,
        lora,
        pages: Number(pages),
        model,
    });
    const webUi = new WebUiManager_1.WebUiManager();
    await webUi.startProcess();
    const imageBlobs = [];
    // Set the appropriate model.
    await (0, apis_1.setStableDiffusionModelCheckpoint)(modelStableDiffusion);
    const titlePageStoryPage = await (0, storyMaker_1.createTitlePageStoryPage)({
        title,
        hero,
        heroTags,
        support,
        supportTags,
        model,
        characterDescriptionMap,
        ollamaContext,
        lora,
    });
    const titlePageImages = await (0, apis_1.getStableDiffusionImages)({
        prompt,
        steps,
        width,
        height,
        sampler,
        storyPage: titlePageStoryPage,
        useRegions: !!(hero && support),
    });
    for (const [index, storyPage] of story.entries()) {
        console.log(storyPage);
        const images = await (0, apis_1.getStableDiffusionImages)({
            prompt,
            steps,
            width,
            height,
            storyPage,
            sampler,
            useRegions: !!(storyPage.heroPrompt && storyPage.supportPrompt),
        });
        for (const [imageIndex, image] of images.entries()) {
            await (0, promises_1.writeFile)(`./stories/${directoryPath}/${index}-${imageIndex}.png`, Buffer.from(image, "base64"));
            if (!imageBlobs[index])
                imageBlobs[index] = [Buffer.from(image, "base64")];
            else
                imageBlobs[index].push(Buffer.from(image, "base64"));
        }
    }
    await Promise.all([
        (0, promises_1.writeFile)(`./stories/${directoryPath}/index.html`, (0, templateGenerator_1.getTemplate)({
            pages: story,
            isEdited: false,
            title: titlePageStoryPage.paragraph,
            hero,
            support,
        })),
        ...titlePageImages.map((image, index) => (0, promises_1.writeFile)(`./stories/${directoryPath}/title-${index}.png`, Buffer.from(image, "base64"))),
        (0, promises_1.writeFile)(`./stories/${directoryPath}/story.json`, JSON.stringify(story)),
        (0, promises_1.writeFile)(`./stories/${directoryPath}/metadata.json`, JSON.stringify({
            titlePageStoryPage,
            hero,
            support,
            lora,
            steps,
            sampler,
            width,
            height,
            heroTags,
            prompt,
            useRegions: story.map((x) => !!(x.heroPrompt && x.supportPrompt)),
        })),
        (0, promises_1.copyFile)("./template/HobbyHorseNF.otf", `./stories/${directoryPath}/HobbyHorseNF.otf`),
    ]);
    webUi.stopProcess();
    return 0;
}
makeStory();
//# sourceMappingURL=script.js.map