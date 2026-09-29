'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var commandType;
(function (commandType) {
    commandType[commandType["say"] = 0] = "say";
    commandType[commandType["changeBg"] = 1] = "changeBg";
    commandType[commandType["changeFigure"] = 2] = "changeFigure";
    commandType[commandType["bgm"] = 3] = "bgm";
    commandType[commandType["video"] = 4] = "video";
    commandType[commandType["pixi"] = 5] = "pixi";
    commandType[commandType["pixiInit"] = 6] = "pixiInit";
    commandType[commandType["intro"] = 7] = "intro";
    commandType[commandType["miniAvatar"] = 8] = "miniAvatar";
    commandType[commandType["changeScene"] = 9] = "changeScene";
    commandType[commandType["choose"] = 10] = "choose";
    commandType[commandType["end"] = 11] = "end";
    commandType[commandType["setComplexAnimation"] = 12] = "setComplexAnimation";
    commandType[commandType["setFilter"] = 13] = "setFilter";
    commandType[commandType["label"] = 14] = "label";
    commandType[commandType["jumpLabel"] = 15] = "jumpLabel";
    commandType[commandType["chooseLabel"] = 16] = "chooseLabel";
    commandType[commandType["setVar"] = 17] = "setVar";
    commandType[commandType["if"] = 18] = "if";
    commandType[commandType["callScene"] = 19] = "callScene";
    commandType[commandType["showVars"] = 20] = "showVars";
    commandType[commandType["unlockCg"] = 21] = "unlockCg";
    commandType[commandType["unlockBgm"] = 22] = "unlockBgm";
    commandType[commandType["filmMode"] = 23] = "filmMode";
    commandType[commandType["setTextbox"] = 24] = "setTextbox";
    commandType[commandType["setAnimation"] = 25] = "setAnimation";
    commandType[commandType["playEffect"] = 26] = "playEffect";
    commandType[commandType["setTempAnimation"] = 27] = "setTempAnimation";
    commandType[commandType["comment"] = 28] = "comment";
    commandType[commandType["setTransform"] = 29] = "setTransform";
    commandType[commandType["setTransition"] = 30] = "setTransition";
    commandType[commandType["getUserInput"] = 31] = "getUserInput";
    commandType[commandType["applyStyle"] = 32] = "applyStyle";
    commandType[commandType["wait"] = 33] = "wait";
    commandType[commandType["callSteam"] = 34] = "callSteam";
    commandType[commandType["return"] = 35] = "return";
    commandType[commandType["attachment"] = 36] = "attachment";
    commandType[commandType["stageEntity"] = 37] = "stageEntity";
})(commandType || (commandType = {}));

const SCRIPT_CONFIG = [
    { scriptString: 'say', scriptType: commandType.say },
    { scriptString: 'changeBg', scriptType: commandType.changeBg },
    { scriptString: 'changeFigure', scriptType: commandType.changeFigure },
    { scriptString: 'bgm', scriptType: commandType.bgm },
    { scriptString: 'playVideo', scriptType: commandType.video },
    { scriptString: 'pixiPerform', scriptType: commandType.pixi },
    { scriptString: 'pixiInit', scriptType: commandType.pixiInit },
    { scriptString: 'intro', scriptType: commandType.intro },
    { scriptString: 'miniAvatar', scriptType: commandType.miniAvatar },
    { scriptString: 'changeScene', scriptType: commandType.changeScene },
    { scriptString: 'choose', scriptType: commandType.choose },
    { scriptString: 'end', scriptType: commandType.end },
    {
        scriptString: 'setComplexAnimation',
        scriptType: commandType.setComplexAnimation,
    },
    { scriptString: 'setFilter', scriptType: commandType.setFilter },
    { scriptString: 'label', scriptType: commandType.label },
    { scriptString: 'jumpLabel', scriptType: commandType.jumpLabel },
    { scriptString: 'chooseLabel', scriptType: commandType.chooseLabel },
    { scriptString: 'setVar', scriptType: commandType.setVar },
    { scriptString: 'if', scriptType: commandType.if },
    { scriptString: 'callScene', scriptType: commandType.callScene },
    { scriptString: 'showVars', scriptType: commandType.showVars },
    { scriptString: 'unlockCg', scriptType: commandType.unlockCg },
    { scriptString: 'unlockBgm', scriptType: commandType.unlockBgm },
    { scriptString: 'filmMode', scriptType: commandType.filmMode },
    { scriptString: 'setTextbox', scriptType: commandType.setTextbox },
    { scriptString: 'setAnimation', scriptType: commandType.setAnimation },
    { scriptString: 'playEffect', scriptType: commandType.playEffect },
    { scriptString: 'setTempAnimation', scriptType: commandType.setTempAnimation },
    // comment?
    { scriptString: 'setTransform', scriptType: commandType.setTransform },
    { scriptString: 'setTransition', scriptType: commandType.setTransition },
    { scriptString: 'getUserInput', scriptType: commandType.getUserInput },
    { scriptString: 'applyStyle', scriptType: commandType.applyStyle },
    { scriptString: 'wait', scriptType: commandType.wait },
    { scriptString: 'callSteam', scriptType: commandType.callSteam },
    { scriptString: 'attachment', scriptType: commandType.attachment },
    { scriptString: 'stageEntity', scriptType: commandType.stageEntity },
    { scriptString: 'return', scriptType: commandType.return },
];
const ADD_NEXT_ARG_LIST = [
    commandType.bgm,
    commandType.pixi,
    commandType.pixiInit,
    commandType.miniAvatar,
    commandType.label,
    commandType.if,
    commandType.setVar,
    commandType.unlockCg,
    commandType.unlockBgm,
    commandType.filmMode,
    commandType.playEffect,
    commandType.setTransition,
    commandType.applyStyle,
    commandType.callSteam,
    // Preserve the legacy default: attachment continues; stageEntity does not.
    commandType.attachment,
];

/**
 * 内置资源类型的枚举
 */
var fileType;
(function (fileType) {
    fileType[fileType["background"] = 0] = "background";
    fileType[fileType["bgm"] = 1] = "bgm";
    fileType[fileType["figure"] = 2] = "figure";
    fileType[fileType["scene"] = 3] = "scene";
    fileType[fileType["tex"] = 4] = "tex";
    fileType[fileType["vocal"] = 5] = "vocal";
    fileType[fileType["video"] = 6] = "video";
})(fileType || (fileType = {}));

/**
 * 参数解析器
 * @param argsRaw 原始参数字符串
 * @param assetSetter
 * @return {Array<arg>} 解析后的参数列表
 */
function argsParser(argsRaw, assetSetter) {
    const returnArrayList = [];
    // 处理参数
    // 不要去空格
    let newArgsRaw = argsRaw.replace(/ /g, ' ');
    // 分割参数列表
    let rawArgsList = newArgsRaw.split(' -');
    // 去除空字符串
    rawArgsList = rawArgsList.filter((e) => {
        return e !== '';
    });
    rawArgsList.forEach((e) => {
        const equalSignIndex = e.indexOf('=');
        let argName = e.slice(0, equalSignIndex).trim();
        let argValue = e.slice(equalSignIndex + 1).trim();
        if (equalSignIndex < 0) {
            argName = e.trim();
            argValue = undefined;
        }
        // 判断是不是语音参数
        if (argName.toLowerCase().match(/.ogg|.mp3|.wav|.opus/)) {
            returnArrayList.push({
                key: 'vocal',
                value: assetSetter(e, fileType.vocal),
            });
        }
        else if (argName === 'vocal' && argValue !== undefined) {
            returnArrayList.push({
                key: argName,
                value: assetSetter(argValue, fileType.vocal),
            });
        }
        // 判断是不是省略参数
        else if (argValue === undefined) {
            returnArrayList.push({
                key: argName,
                value: true,
            });
        }
        // 是字符串描述的布尔值
        else if (argValue === 'true' || argValue === 'false') {
            returnArrayList.push({
                key: argName,
                value: argValue === 'true',
            });
        }
        // 是数字
        else if (!isNaN(Number(argValue))) {
            returnArrayList.push({
                key: argName,
                value: Number(argValue),
            });
        }
        // 是普通参数
        else {
            returnArrayList.push({
                key: argName,
                value: argValue,
            });
        }
    });
    return returnArrayList;
}

function configLineParser(inputLine) {
    const options = [];
    let command;
    let newSentenceRaw = inputLine.split(';')[0];
    if (newSentenceRaw === '') {
        // 注释提前返回
        return {
            command: '',
            args: [],
            options: [],
        };
    }
    // 截取命令
    const getCommandResult = /\s*:\s*/.exec(newSentenceRaw);
    // 没有command
    if (getCommandResult === null) {
        command = '';
    }
    else {
        command = newSentenceRaw.substring(0, getCommandResult.index);
        // 划分命令区域和content区域
        newSentenceRaw = newSentenceRaw.substring(getCommandResult.index + 1, newSentenceRaw.length);
    }
    // 截取 Options 区域
    const getOptionsResult = / -/.exec(newSentenceRaw);
    // 获取到参数
    if (getOptionsResult) {
        const optionsRaw = newSentenceRaw.substring(getOptionsResult.index, newSentenceRaw.length);
        newSentenceRaw = newSentenceRaw.substring(0, getOptionsResult.index);
        for (const e of argsParser(optionsRaw, (name, _) => {
            return name;
        })) {
            options.push(e);
        }
    }
    return {
        command,
        args: newSentenceRaw
            .split('|')
            .map((e) => e.trim())
            .filter((e) => e !== ''),
        options,
    };
}
function configParser(configText) {
    const configLines = configText.replaceAll(`\r`, '').split('\n');
    return configLines
        .map((e) => configLineParser(e))
        .filter((e) => e.command !== '');
}

/**
 * 处理命令
 * @param commandRaw
 * @param ADD_NEXT_ARG_LIST
 * @param SCRIPT_CONFIG_MAP
 * @return {parsedCommand} 处理后的命令
 */
const commandParser = (commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP) => {
    let returnCommand = {
        type: commandType.say,
        additionalArgs: [],
    };
    // 开始处理命令内容
    const type = getCommandType(commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP);
    returnCommand.type = type;
    // 如果是对话，加上额外的参数
    if (type === commandType.say && commandRaw !== 'say') {
        returnCommand.additionalArgs.push({
            key: 'speaker',
            value: commandRaw,
        });
    }
    returnCommand = addNextArg(returnCommand, type, ADD_NEXT_ARG_LIST);
    return returnCommand;
};
/**
 * 根据command原始值判断是什么命令
 * @param command command原始值
 * @param ADD_NEXT_ARG_LIST
 * @param SCRIPT_CONFIG_MAP
 * @return {commandType} 得到的command类型
 */
function getCommandType(command, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP) {
    return SCRIPT_CONFIG_MAP.get(command)?.scriptType ?? commandType.say;
}
function addNextArg(commandToParse, thisCommandType, ADD_NEXT_ARG_LIST) {
    if (ADD_NEXT_ARG_LIST.includes(thisCommandType)) {
        commandToParse.additionalArgs.push({
            key: 'next',
            value: true,
        });
    }
    return commandToParse;
}

/**
 * 解析语句内容的函数，主要作用是把文件名改为绝对地址或相对地址（根据使用情况而定）
 * @param contentRaw 原始语句内容
 * @param type 语句类型
 * @param assetSetter
 * @return {string} 解析后的语句内容
 */
const contentParser = (contentRaw, type, assetSetter) => {
    if (contentRaw === 'none' || contentRaw === '') {
        return '';
    }
    switch (type) {
        case commandType.playEffect:
            return assetSetter(contentRaw, fileType.vocal);
        case commandType.changeBg:
            return assetSetter(contentRaw, fileType.background);
        case commandType.changeFigure:
            return assetSetter(contentRaw, fileType.figure);
        case commandType.bgm:
            return assetSetter(contentRaw, fileType.bgm);
        case commandType.callScene:
            return assetSetter(contentRaw, fileType.scene);
        case commandType.changeScene:
            return assetSetter(contentRaw, fileType.scene);
        case commandType.miniAvatar:
            return assetSetter(contentRaw, fileType.figure);
        case commandType.video:
            return assetSetter(contentRaw, fileType.video);
        case commandType.choose:
            return getChooseContent(contentRaw, assetSetter);
        case commandType.unlockBgm:
            return assetSetter(contentRaw, fileType.bgm);
        case commandType.unlockCg:
            return assetSetter(contentRaw, fileType.background);
        default:
            return contentRaw;
    }
};
function getChooseContent(contentRaw, assetSetter) {
    const chooseList = contentRaw.split(/(?<!\\)\|/);
    const chooseKeyList = [];
    const chooseValueList = [];
    for (const e of chooseList) {
        chooseKeyList.push(e.split(/(?<!\\):/)[0] ?? '');
        chooseValueList.push(e.split(/(?<!\\):/)[1] ?? '');
    }
    const parsedChooseList = chooseValueList.map((e) => {
        if (e.match(/\./)) {
            return assetSetter(e, fileType.scene);
        }
        else {
            return e;
        }
    });
    let ret = '';
    for (let i = 0; i < chooseKeyList.length; i++) {
        if (i !== 0) {
            ret = ret + '|';
        }
        ret = ret + `${chooseKeyList[i]}:${parsedChooseList[i]}`;
    }
    return ret;
}

/**
 * 根据语句类型、语句内容、参数列表，扫描该语句可能携带的资源
 * @param command 语句类型
 * @param content 语句内容
 * @param args 参数列表
 * @return {Array<IAsset>} 语句携带的参数列表
 */
const assetsScanner = (command, content, args, lineNumber) => {
    const returnAssetsList = [];
    if (command === commandType.say) {
        args.forEach((e) => {
            if (e.key === 'vocal') {
                returnAssetsList.push({
                    name: e.value,
                    url: e.value,
                    lineNumber,
                    type: fileType.vocal,
                });
            }
        });
    }
    if (content === 'none' || content === '') {
        return returnAssetsList;
    }
    // 处理语句携带的资源
    if (command === commandType.changeBg) {
        returnAssetsList.push({
            name: content,
            url: content,
            lineNumber,
            type: fileType.background,
        });
    }
    if (command === commandType.changeFigure) {
        returnAssetsList.push({
            name: content,
            url: content,
            lineNumber,
            type: fileType.figure,
        });
    }
    if (command === commandType.miniAvatar) {
        returnAssetsList.push({
            name: content,
            url: content,
            lineNumber,
            type: fileType.figure,
        });
    }
    if (command === commandType.video) {
        returnAssetsList.push({
            name: content,
            url: content,
            lineNumber,
            type: fileType.video,
        });
    }
    if (command === commandType.bgm) {
        returnAssetsList.push({
            name: content,
            url: content,
            lineNumber,
            type: fileType.bgm,
        });
    }
    return returnAssetsList;
};

/**
 * 扫描子场景
 * @param content 语句内容
 * @return {Array<string>} 子场景列表
 */
const subSceneScanner = (command, content) => {
    const subSceneList = [];
    if (command === commandType.changeScene ||
        command === commandType.callScene) {
        subSceneList.push(content);
    }
    if (command === commandType.choose) {
        const chooseList = content.split('|');
        const chooseValue = chooseList.map((e) => e.split(':')[1] ?? '');
        chooseValue.forEach((e) => {
            if (e.match(/\./)) {
                subSceneList.push(e);
            }
        });
    }
    return subSceneList;
};

/**
 * 语句解析器
 * @param sentenceRaw 原始语句
 * @param assetSetter
 * @param ADD_NEXT_ARG_LIST
 * @param SCRIPT_CONFIG_MAP
 */
const scriptParser = (sentenceRaw, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP, lineNumber = 0) => {
    let command; // 默认为对话
    let content; // 语句内容
    let subScene; // 语句携带的子场景（可能没有）
    const args = []; // 语句参数列表
    let sentenceAssets; // 语句携带的资源列表
    let parsedCommand; // 解析后的命令
    let commandRaw;
    // 正式开始解析
    // 去分号
    const commentSplit = sentenceRaw.split(/(?<!\\);/);
    let newSentenceRaw = commentSplit[0];
    newSentenceRaw = newSentenceRaw.replaceAll('\\;', ';');
    const sentenceComment = commentSplit.slice(1).join(';');
    if (newSentenceRaw.trim() === '') {
        // 注释提前返回
        return {
            command: commandType.comment,
            commandRaw: 'comment',
            content: sentenceComment.trim(),
            args: [{ key: 'next', value: true }],
            sentenceAssets: [],
            subScene: [],
            inlineComment: '',
            startLine: lineNumber,
            endLine: lineNumber,
            isLineBreakHolder: false,
        };
    }
    // 截取命令
    const getCommandResult = /:/.exec(newSentenceRaw);
    /**
     * 拆分命令和语句，同时处理连续对话。
     */
    // 没有command，说明这是一条连续对话或单条语句
    if (getCommandResult === null) {
        commandRaw = newSentenceRaw;
        parsedCommand = commandParser(commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP);
        command = parsedCommand.type;
        for (const e of parsedCommand.additionalArgs) {
            // 由于是连续对话，所以我们去除 speaker 参数。
            if (command === commandType.say && e.key === 'speaker') {
                continue;
            }
            args.push(e);
        }
    }
    else {
        commandRaw = newSentenceRaw.substring(0, getCommandResult.index);
        // 划分命令区域和content区域
        newSentenceRaw = newSentenceRaw.substring(getCommandResult.index + 1, newSentenceRaw.length);
        parsedCommand = commandParser(commandRaw, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP);
        command = parsedCommand.type;
        for (const e of parsedCommand.additionalArgs) {
            args.push(e);
        }
    }
    // 截取参数区域
    const getArgsResult = / -/.exec(newSentenceRaw);
    // 获取到参数
    if (getArgsResult) {
        const argsRaw = newSentenceRaw.substring(getArgsResult.index, sentenceRaw.length);
        newSentenceRaw = newSentenceRaw.substring(0, getArgsResult.index);
        for (const e of argsParser(argsRaw, assetSetter)) {
            args.push(e);
        }
    }
    content = contentParser(newSentenceRaw.trim(), command, assetSetter); // 将语句内容里的文件名转为相对或绝对路径
    sentenceAssets = assetsScanner(command, content, args, lineNumber); // 扫描语句携带资源
    subScene = subSceneScanner(command, content); // 扫描语句携带子场景
    return {
        command: command,
        commandRaw: commandRaw.trim(),
        content: content,
        args: args,
        sentenceAssets: sentenceAssets,
        subScene: subScene,
        inlineComment: sentenceComment.trim(),
        // 单行语句的行范围就是自己，多行语句的 endLine 由 sceneParser 回填
        startLine: lineNumber,
        endLine: lineNumber,
        isLineBreakHolder: false,
    };
};

/**
 * Preprocessor for scene text.
 *
 * Use two-pass to generate a new scene text that concats multiline sequences
 * into a single line and add placeholder lines to preserve the original number
 * of lines.
 *
 * @param sceneText The original scene text
 * @returns The processed scene text
 */
function sceneTextPreProcess(sceneText) {
    let lines = sceneText.replaceAll('\r', '').split('\n');
    lines = sceneTextPreProcessPassOne(lines);
    lines = sceneTextPreProcessPassTwo(lines);
    return lines.join('\n');
}
/**
 * Pass one.
 *
 * Add escape character to all lines that should be multiline.
 *
 * @param lines The original lines
 * @returns The processed lines
 */
function sceneTextPreProcessPassOne(lines) {
    const processedLines = [];
    let lastLineIsMultiline = false;
    let thisLineIsMultiline = false;
    for (const line of lines) {
        // 续行需要接到上一行，所以场景的第一行永远不会是续行。
        thisLineIsMultiline =
            processedLines.length > 0 &&
                canBeMultiline(line) &&
                !shouldNotBeMultiline(line, lastLineIsMultiline);
        if (thisLineIsMultiline) {
            processedLines[processedLines.length - 1] += '\\';
        }
        processedLines.push(line);
        lastLineIsMultiline = thisLineIsMultiline;
    }
    return processedLines;
}
function canBeMultiline(line) {
    if (!line.startsWith(' ')) {
        return false;
    }
    const trimmedLine = line.trimStart();
    return trimmedLine.startsWith('|') || trimmedLine.startsWith('-');
}
/**
 * Logic to check if a line should not be multiline.
 *
 * @param line The line to check
 * @returns If the line should not be multiline
 */
function shouldNotBeMultiline(line, lastLineIsMultiline) {
    if (!lastLineIsMultiline && isEmptyLine(line)) {
        return true;
    }
    // Custom logic: if the line contains -concat, it should not be multiline
    if (line.indexOf('-concat') !== -1) {
        return true;
    }
    return false;
}
function isEmptyLine(line) {
    return line.trim() === '';
}
/**
 * Pass two.
 *
 * Traverse the lines to
 * - remove escape characters
 * - add placeholder lines to preserve the original number of lines.
 *
 * @param lines The lines in pass one
 * @returns The processed lines
 */
function sceneTextPreProcessPassTwo(lines) {
    const processedLines = [];
    // null 表示当前不在多行序列里。这里不能用空串来判断：
    // 序列的首行本身可能就是空行（比如空行后面紧跟着一条续行），
    // 那样整条序列会被静默丢弃，破坏「预处理前后行数一致」这个前提。
    let currentMultilineContent = null;
    let placeHolderLines = [];
    function concat(line) {
        let trimmed = line.trim();
        if (trimmed.startsWith('-')) {
            trimmed = " " + trimmed;
        }
        currentMultilineContent = currentMultilineContent + trimmed;
        placeHolderLines.push(placeholderLine(line));
    }
    /** 把折叠好的整条语句连同补齐行数的占位行一起输出 */
    function flushMultiline() {
        processedLines.push(currentMultilineContent, ...placeHolderLines);
        placeHolderLines = [];
        currentMultilineContent = null;
    }
    for (const line of lines) {
        if (line.endsWith('\\')) {
            const trueLine = line.slice(0, -1);
            if (currentMultilineContent === null) {
                // first line
                currentMultilineContent = trueLine;
            }
            else {
                // middle line
                concat(trueLine);
            }
            continue;
        }
        if (currentMultilineContent !== null) {
            // end line
            concat(line);
            flushMultiline();
            continue;
        }
        processedLines.push(line);
    }
    // 场景末行仍以 \ 结尾时循环里没有机会收尾，在这里把累积的内容补出去。
    if (currentMultilineContent !== null) {
        flushMultiline();
    }
    return processedLines;
}
/**
 * 占位行的前缀。占位行本身是一条注释，引擎会空跑掉；
 * 它的作用是让预处理后的行数与原始场景一致，从而保持
 * 「解析后语句 index == 文件行号」这一不变量。
 */
const WEBGAL_LINE_BREAK_MARK = ';_WEBGAL_LINE_BREAK_';
/**
 * 判断预处理后的某一行是否是占位行，即它是上一条多行语句折叠掉的续行。
 */
function isLineBreakPlaceholder(processedLine) {
    return processedLine.startsWith(WEBGAL_LINE_BREAK_MARK);
}
/**
 * Placeholder Line. Adding this line preserves the original number of lines
 * in the scene text, so that it can be compatible with the graphical editor.
 *
 * @param content The original content on this line
 * @returns The placeholder line
 */
function placeholderLine(content = "") {
    return WEBGAL_LINE_BREAK_MARK + content;
}

/**
 * 场景解析器
 * @param rawScene 原始场景
 * @param sceneName 场景名称
 * @param sceneUrl 场景url
 * @param assetsPrefetcher
 * @param assetSetter
 * @param ADD_NEXT_ARG_LIST
 * @param SCRIPT_CONFIG_MAP
 * @return {IScene} 解析后的场景
 */
const sceneParser = (rawScene, sceneName, sceneUrl, assetsPrefetcher, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP) => {
    // 预处理把多行语句折叠进它的首行，并用占位行补齐被折叠掉的行，
    // 因此这里的行数与原始场景严格一致，「语句 index == 文件行号」始终成立。
    const rawSentenceList = sceneTextPreProcess(rawScene).split('\n'); // 原始句子列表
    // 去分号留到后面去做了，现在注释要单独处理
    const rawSentenceListWithoutEmpty = rawSentenceList;
    // .map((sentence) => sentence.split(";")[0])
    // .filter((sentence) => sentence.trim() !== "");
    let assetsList = []; // 场景资源列表
    let subSceneList = []; // 子场景列表
    const sentenceList = rawSentenceListWithoutEmpty.map((sentence, index) => {
        const returnSentence = scriptParser(sentence, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_MAP, index);
        // 在这里解析出语句可能携带的资源和场景，合并到 assetsList 和 subSceneList
        assetsList = [...assetsList, ...returnSentence.sentenceAssets];
        subSceneList = [...subSceneList, ...returnSentence.subScene];
        return returnSentence;
    });
    markMultilineRanges(sentenceList, rawSentenceList);
    // 开始资源的预加载
    assetsList = deduplicateAssets(assetsList);
    assetsPrefetcher(assetsList);
    return {
        sceneName: sceneName,
        sceneUrl: sceneUrl,
        sentenceList: sentenceList,
        assetsList: assetsList,
        subSceneList: subSceneList, // 子场景列表
    };
};
/**
 * 回填多行语句的行范围。
 *
 * 预处理后，一条多行语句的完整内容都落在它的首行，紧跟其后的若干占位行
 * 就是被折叠掉的续行。这里把占位行标记出来，并把首行语句的 endLine
 * 推到最后一条续行，图形编辑器据此按整个行范围替换语句。
 *
 * @param sentenceList 解析后的语句列表
 * @param processedLines 预处理后的行，与 sentenceList 一一对应
 */
const markMultilineRanges = (sentenceList, processedLines) => {
    let headIndex = -1; // 最近一条非占位语句的下标，即当前多行语句的首行
    for (let index = 0; index < sentenceList.length; index++) {
        if (!isLineBreakPlaceholder(processedLines[index])) {
            headIndex = index;
            continue;
        }
        sentenceList[index].isLineBreakHolder = true;
        if (headIndex >= 0) {
            sentenceList[headIndex].endLine = index;
        }
    }
};
const deduplicateAssets = (assetsList) => {
    const seenAssets = new Set();
    return assetsList.filter((asset) => {
        if (!asset || typeof asset.url !== 'string' || asset.url === '') {
            return false;
        }
        const assetKey = `${asset.type}:${asset.url}`;
        if (seenAssets.has(assetKey)) {
            return false;
        }
        seenAssets.add(assetKey);
        return true;
    });
};

function scss2cssinjsParser(scssString) {
    const [classNameStyles, others] = parseCSS(scssString);
    return {
        classNameStyles,
        others,
    };
}
/**
 * GPT 4 写的，临时用，以后要重构！！！
 * TODO：用人类智能重构，要是用着一直没问题，也不是不可以 trust AI
 * @param css
 */
function parseCSS(css) {
    const result = {};
    let specialRules = '';
    let matches;
    // 使用非贪婪匹配，尝试正确处理任意层次的嵌套
    const classRegex = /\.([^{\s]+)\s*{((?:[^{}]*|{[^}]*})*)}/g;
    const specialRegex = /(@[^{]+{\s*(?:[^{}]*{[^}]*}[^{}]*)+\s*})/g;
    while ((matches = classRegex.exec(css)) !== null) {
        const key = matches[1];
        const value = matches[2].trim().replace(/\s*;\s*/g, ';\n');
        result[key] = value;
    }
    while ((matches = specialRegex.exec(css)) !== null) {
        specialRules += matches[1].trim() + '\n';
    }
    return [result, specialRules.trim()];
}

/** Stamp new serialized data at the host boundary, not on ordinary script text. */
const ATTACHMENT_COMMAND_ABI = 'webgal-mygo3.2.1-attachment-v1';
const MYGO320_ATTACHMENT_COMMAND_ABI = 'webgal-mygo3.2.0-attachment-v1';
const UPSTREAM_MYGO321_COMMAND_ABI = 'webgal-mygo3.2.1';
const LEGACY_HOTFIX37_COMMAND_ABI = 'webgal-mygo3.0.0-hotfix37';
const UPSTREAM_MYGO320_COMMAND_ABI = 'webgal-mygo3.2.0';
const extensionNames = ['callSteam', 'return', 'attachment', 'stageEntity'];
const currentIds = {
    callSteam: commandType.callSteam,
    return: commandType.return,
    attachment: commandType.attachment,
    stageEntity: commandType.stageEntity,
};
/**
 * Resolve only the numeric command ABI, without mutating or loading a save.
 * A caller must identify the source ABI from its validated envelope/provenance;
 * it must NOT stamp old data with the current ABI just because this parser runs.
 * Unversioned extension IDs need an exact commandRaw witness. No action/target
 * heuristics: 34 can mean legacy attachment or upstream callSteam, and 35 can
 * mean legacy stageEntity or current attachment.
 * This is not a sentence/save validator or an installed storage migration hook.
 */
function resolveSerializedCommandType(input) {
    const { command, commandRaw, sourceAbi } = input;
    if (sourceAbi !== undefined &&
        sourceAbi !== ATTACHMENT_COMMAND_ABI &&
        sourceAbi !== LEGACY_HOTFIX37_COMMAND_ABI &&
        sourceAbi !== MYGO320_ATTACHMENT_COMMAND_ABI &&
        sourceAbi !== UPSTREAM_MYGO321_COMMAND_ABI &&
        sourceAbi !== UPSTREAM_MYGO320_COMMAND_ABI) {
        return { ok: false, code: 'COMMAND_ABI_UNSUPPORTED' };
    }
    if (typeof command !== 'number' ||
        !Number.isInteger(command) ||
        command < 0 ||
        command > commandType.stageEntity) {
        return { ok: false, code: 'COMMAND_ABI_INVALID_COMMAND' };
    }
    if (commandRaw !== undefined && typeof commandRaw !== 'string') {
        return { ok: false, code: 'COMMAND_ABI_INVALID_RAW' };
    }
    // The locked old/new host command range 0..33 is unchanged. Preserve it;
    // arbitrary speaker names in commandRaw must remain valid for dialogue.
    if (command <= commandType.wait) {
        return { ok: true, command, migrated: false };
    }
    const raw = typeof commandRaw === 'string' ? commandRaw.trim() : '';
    let name;
    if (sourceAbi === LEGACY_HOTFIX37_COMMAND_ABI) {
        name =
            command === 34
                ? 'attachment'
                : command === 35
                    ? 'stageEntity'
                    : undefined;
    }
    else if (sourceAbi === UPSTREAM_MYGO320_COMMAND_ABI) {
        name = command === 34 ? 'callSteam' : undefined;
    }
    else if (sourceAbi === UPSTREAM_MYGO321_COMMAND_ABI) {
        name = command === 34 ? 'callSteam' : command === 35 ? 'return' : undefined;
    }
    else if (sourceAbi === MYGO320_ATTACHMENT_COMMAND_ABI) {
        name = command === 34 ? 'callSteam' : command === 35 ? 'attachment' : command === 36 ? 'stageEntity' : undefined;
    }
    else if (sourceAbi === ATTACHMENT_COMMAND_ABI) {
        name = extensionNames.find((candidate) => currentIds[candidate] === command);
    }
    else {
        name = extensionNames.find((candidate) => candidate === raw);
        if (!name)
            return { ok: false, code: 'COMMAND_ABI_AMBIGUOUS' };
        const matchingId = name === 'callSteam'
            ? command === 34
            : name === 'return'
                ? command === 35
                : name === 'attachment'
                    ? command === 34 || command === 35 || command === 36
                    : command === 35 || command === 36 || command === 37;
        if (!matchingId)
            return { ok: false, code: 'COMMAND_ABI_RAW_MISMATCH' };
    }
    if (!name)
        return { ok: false, code: 'COMMAND_ABI_INVALID_COMMAND' };
    if (raw && raw !== name)
        return { ok: false, code: 'COMMAND_ABI_RAW_MISMATCH' };
    const resolved = currentIds[name];
    return { ok: true, command: resolved, migrated: resolved !== command };
}

class SceneParser {
    assetsPrefetcher;
    assetSetter;
    ADD_NEXT_ARG_LIST;
    SCRIPT_CONFIG_MAP;
    constructor(assetsPrefetcher, assetSetter, ADD_NEXT_ARG_LIST, SCRIPT_CONFIG_INPUT) {
        this.assetsPrefetcher = assetsPrefetcher;
        this.assetSetter = assetSetter;
        this.ADD_NEXT_ARG_LIST = ADD_NEXT_ARG_LIST;
        if (Array.isArray(SCRIPT_CONFIG_INPUT)) {
            this.SCRIPT_CONFIG_MAP = new Map();
            SCRIPT_CONFIG_INPUT.forEach((config) => {
                this.SCRIPT_CONFIG_MAP.set(config.scriptString, config);
            });
        }
        else {
            this.SCRIPT_CONFIG_MAP = SCRIPT_CONFIG_INPUT;
        }
    }
    /**
     * 解析场景
     * @param rawScene 原始场景
     * @param sceneName 场景名称
     * @param sceneUrl 场景url
     * @return 解析后的场景
     */
    parse(rawScene, sceneName, sceneUrl) {
        return sceneParser(rawScene, sceneName, sceneUrl, this.assetsPrefetcher, this.assetSetter, this.ADD_NEXT_ARG_LIST, this.SCRIPT_CONFIG_MAP);
    }
    parseConfig(configText) {
        return configParser(configText);
    }
    stringifyConfig(config) {
        return config.reduce((previousValue, curr) => previousValue +
            `${curr.command}:${curr.args.join('|')}${curr.options.length <= 0
                ? ''
                : curr.options.reduce((p, c) => p + ' -' + c.key + '=' + c.value, '')};\n`, '');
    }
    parseScssToWebgalStyleObj(scssString) {
        return scss2cssinjsParser(scssString);
    }
}

exports.ADD_NEXT_ARG_LIST = ADD_NEXT_ARG_LIST;
exports.ATTACHMENT_COMMAND_ABI = ATTACHMENT_COMMAND_ABI;
exports.LEGACY_HOTFIX37_COMMAND_ABI = LEGACY_HOTFIX37_COMMAND_ABI;
exports.MYGO320_ATTACHMENT_COMMAND_ABI = MYGO320_ATTACHMENT_COMMAND_ABI;
exports.SCRIPT_CONFIG = SCRIPT_CONFIG;
exports.UPSTREAM_MYGO320_COMMAND_ABI = UPSTREAM_MYGO320_COMMAND_ABI;
exports.UPSTREAM_MYGO321_COMMAND_ABI = UPSTREAM_MYGO321_COMMAND_ABI;
exports.WEBGAL_LINE_BREAK_MARK = WEBGAL_LINE_BREAK_MARK;
exports.default = SceneParser;
exports.isLineBreakPlaceholder = isLineBreakPlaceholder;
exports.resolveSerializedCommandType = resolveSerializedCommandType;
exports.sceneTextPreProcess = sceneTextPreProcess;
