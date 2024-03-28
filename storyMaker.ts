import { getOllamaString, getStoryPages } from "./apis";
import { StoryPage } from "./types";

export async function createStory({
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
  pages,
  model,
}: {
  genre: string;
  storyPlot: string;
  hero: string;
  heroDescription: string;
  heroTags: string;
  support: string;
  supportDescription: string;
  supportTags: string;
  supportLora: string;
  lora: string;
  pages: number;
  model: string;
}): Promise<{
  story: StoryPage[];
  title: string;
  characterDescriptionMap: Record<string, string>;
  ollamaContext: number[];
}> {
  const fullPrompt = `Make me a ${genre} about ${heroDescription} named ${hero} ${
    storyPlot ? `where ${storyPlot} ` : ""
  }in ${pages} separate parts. 
  Do not mention hair, eye, or skin colour.
  ${
    support.length
      ? `Include a person named ${support} that is ${supportDescription}.`
      : ""
  }

  Respond in JSON by placing an array in a key called story that holds each part. 
  Each array element contains an object with the following format: { "paragraph": the paragraph as a string }`;

  let ollamaContext: number[] = null;
  const { response: story, context: storyContext } = await getStoryPages(
    fullPrompt,
    model
  );
  ollamaContext = storyContext;

  const { response: titleResponse, context: titleContext } =
    await getOllamaString(
      `What would be a good name for this story? Make it brief and catchy. Respond in JSON with the following format: {
        "story_name": the name as a string
      }`,
      model,
      ollamaContext
    );
  const title = JSON.parse(titleResponse).story_name;
  ollamaContext = titleContext;

  const characterNamePromopt = `Tell me names we can use to refer to the people and animals in the story. 
    Only include important characters.
    Include ${hero} in the list.
    ${support.length ? `Include ${support} in the list.` : ""}
    Respond in JSON by placing a an array of the names as strings in a key called names`;
  const characterNamesResp = await getOllamaString(
    characterNamePromopt,
    model,
    storyContext
  );
  const characterNameRespJson: {
    names: string[];
  } = JSON.parse(characterNamesResp.response);
  ollamaContext = characterNamesResp.context;

  const characterDescriptionMap: Record<string, string> = {};
  for (const [index, { paragraph }] of story.entries()) {
    const checkPrompt = `Using this paragraph, tell me what people or animals are visible: "${paragraph}".
      Refer to them by name from this list: ${characterNameRespJson.names.join(
        ", "
      )}.
      Assume that any use of the word "they", "them", or "their" means the people and animals in the story.
      Only include the names of the people and animals that are explicitly mentioned.
      Respond in JSON with the following format: {
        "people": a list of the people,
        "animals": a list of the animals
      }
    `;
    const checkResp = await getOllamaString(checkPrompt, model, ollamaContext);
    ollamaContext = checkResp.context;
    const checkRespJson: {
      people: string[];
      animals: string[];
    } = JSON.parse(checkResp.response);

    const filteredCharacters = [
      ...(checkRespJson.people?.filter(
        (x) => !x?.toLowerCase()?.includes(hero.toLowerCase()) && x?.length >= 1
      ) || []),
      ...(checkRespJson.animals?.filter(
        (x) => !x?.toLowerCase()?.includes(hero.toLowerCase()) && x?.length >= 1
      ) || []),
    ];

    if (support.length) {
      characterDescriptionMap[support] = `<lora:${supportLora}:1>${
        /*Math.random() < 0.5 ? `easyphoto_face, ` :*/ ""
      }${supportTags}`;
    }

    for (const character of filteredCharacters) {
      const isHuman = checkRespJson.people?.includes(character);
      if (!character.length) continue;

      if (!characterDescriptionMap[character]) {
        const descriptionPrompt = `Be creative and in a single sentence describe what ${character} looks like.
         ${isHuman ? `Include their gender as "a man", or "a woman".` : ""}  
         ${isHuman ? `Include their ethnicity.` : ""}
         Do not mention ${hero} or any other characters.

         Respond in JSON with the following format: {
           "description": the description as a string - do not return an array
         }
        `;
        const characterDescription = await getOllamaString(
          descriptionPrompt,
          model,
          ollamaContext
        );
        const characterDescriptionJson: {
          description: string;
        } = JSON.parse(characterDescription.response);
        ollamaContext = characterDescription.context;

        characterDescriptionMap[character] =
          characterDescriptionJson.description.toString();
      }
    }

    const character =
      filteredCharacters[Math.floor(Math.random() * filteredCharacters.length)];

    if (filteredCharacters.length) {
      const descriptionPrompt = `Be creative and in a single sentence describe how ${character} would react to this paragraph: "${paragraph}". 
        Do not mention ${hero} or any other characters.
        Do not use the words "they", "them", or "their".
        Respond in JSON with the following format: {
          "description": the description as a string - do not return an array
        }
      `;
      //const descriptionPrompt = "say poop";
      const description = await getOllamaString(
        descriptionPrompt,
        model,
        ollamaContext
      );
      const descriptionJson: {
        description: string;
      } = JSON.parse(description.response);
      ollamaContext = description.context;

      story[index].supportPrompt = `${characterDescriptionMap[
        character
      ].toString()}, ${descriptionJson.description.toString()}`;
    }

    const backgroundPrompt = `Be creative and in a sentence or two describe what the scene looks like in this paragraph: "${paragraph}".
    Do not mention ${hero}${
      story[index].supportPrompt ? `, ${character},` : ""
    } or any other characters.
    Respond in JSON with the following format: {
      "background": the description as a string - do not return an array
    }
  `;
    const background = await getOllamaString(
      backgroundPrompt,
      model,
      ollamaContext
    );
    const backgroundJson: {
      background: string;
    } = JSON.parse(background.response);
    ollamaContext = background.context;
    story[index].background = backgroundJson.background;

    if (checkRespJson.people?.includes(hero)) {
      const heroDescriptionPrompt = `Be creative and in a single sentence describe how ${hero} would react to this paragraph: "${paragraph}" 
      Ensure we respect their description: ${heroTags}. 
      Do not mention hair, eye, or skin colour.
      ${character ? `Do not mention ${character} or any other characters.` : ""}
      Do not use the words "they", "them", or "their".
      Respond in JSON with the following format: {
        "description": the description as a string - do not return an array
      }`;
      const heroDescription = await getOllamaString(
        heroDescriptionPrompt,
        model,
        ollamaContext
      );
      ollamaContext = heroDescription.context;
      const heroDescriptionJson: {
        description: string;
      } = JSON.parse(heroDescription.response);
      story[index].heroPrompt = `<lora:${lora}:1>${
        /*Math.random() < 0.5 ? `easyphoto_face, ` :*/ ""
      }${heroTags}, ${heroDescriptionJson.description.toString()}`;
    }
  }

  console.log(
    "### Character Descriptions: ",
    JSON.stringify(characterDescriptionMap, null, 2)
  );

  return { story, title, characterDescriptionMap, ollamaContext };
}

export async function createTitlePageStoryPage({
  title,
  hero,
  heroTags,
  support,
  supportTags,
  model,
  characterDescriptionMap,
  ollamaContext,
  lora,
}: {
  title: string;
  hero: string;
  heroTags: string;
  support?: string;
  supportTags?: string;
  model: string;
  characterDescriptionMap: Record<string, string>;
  ollamaContext: number[];
  lora: string;
}): Promise<StoryPage> {
  const heroTitlePrompt = `
    Be creative and in a single sentence describe how ${hero} would look on the cover of a book called ${title}.
    Ensure we respect their description: ${heroTags}.
    Do not mention hair, eye, or skin colour.
    ${support ? `Do not mention ${support} or any other characters.` : ""}
    Do not use the words "they", "them", or "their".
    Respond in JSON with the following format: {
      "description": the description as a string - do not return an array
    }
  `;
  const heroTitleDescription = await getOllamaString(
    heroTitlePrompt,
    model,
    ollamaContext
  );
  ollamaContext = heroTitleDescription.context;
  const heroTitleDescriptionJson: {
    description: string;
  } = JSON.parse(heroTitleDescription.response);

  const supportTitlePrompt = `
    Be creative and in a single sentence describe how ${support} would look on the cover of a book called ${title}.
    Ensure we respect their description: ${supportTags}.
    Do not mention hair, eye, or skin colour.
    Do not mention ${hero} or any other characters.
    Do not use the words "they", "them", or "their".
    Respond in JSON with the following format: {
      "description": the description as a string - do not return an array
    }
  `;
  const supportTitleDescription = await getOllamaString(
    supportTitlePrompt,
    model,
    ollamaContext
  );
  ollamaContext = supportTitleDescription.context;
  const supportTitleDescriptionJson: {
    description: string;
  } = JSON.parse(supportTitleDescription.response);

  return {
    paragraph: title,
    heroPrompt: `<lora:${lora}:1>${heroTags}, ${heroTitleDescriptionJson.description.toString()}`,
    supportPrompt: support
      ? `${characterDescriptionMap[
          support
        ].toString()}, ${supportTitleDescriptionJson.description.toString()}`
      : null,
    background:
      "a beautiful landscape, with a clear blue sky and a few fluffy clouds",
  };
}
