// Generated from creator/creatorModelFiles.ts by generate-model-contract.mjs.
/** Shared import contract. The service uses a generated JavaScript copy of this file. */
export const MODEL_IMPORT_MAX_BYTES = 96 * 1024 * 1024;
export const MODEL_IMPORT_MAX_FILES = 2048;
export const MODEL_IMPORT_BODY_BYTES = 132 * 1024 * 1024;
export function modelImportPath(value) {
    if (typeof value !== 'string' || !value || /[\\%\u0000-\u001f<>:"|?*]/.test(value))
        throw new Error('CREATOR_MODEL_IMPORT_PATH_INVALID');
    const parts = value.split('/');
    if (parts.some((p) => !p || p === '.' || p === '..' || /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p)))
        throw new Error('CREATOR_MODEL_IMPORT_PATH_INVALID');
    return value;
}
/** Model references may use ../ inside the explicitly selected folder, never outside it. */
export function modelImportReference(entry, ref) {
    modelImportPath(entry);
    if (typeof ref !== 'string' || !ref || /^[\/\\]/.test(ref) || /[\\%\u0000-\u001f<>:"|?*]/.test(ref))
        throw new Error('CREATOR_MODEL_IMPORT_REFERENCE_INVALID');
    const result = entry.split('/').slice(0, -1);
    for (const part of ref.split('/')) {
        if (part === '.')
            continue;
        if (part === '..') {
            if (!result.length)
                throw new Error('CREATOR_MODEL_IMPORT_OUTSIDE_FOLDER');
            result.pop();
        }
        else
            result.push(part);
    }
    return modelImportPath(result.join('/'));
}
/** mygo3.2.0 attachment support is the Cubism 2 model.json family. No guessed conversion. */
export function modelImportDependencies(entry, raw) {
    modelImportPath(entry);
    const model = raw;
    if (!model || Array.isArray(model) || typeof model !== 'object')
        throw new Error('CREATOR_MODEL_IMPORT_JSON_INVALID');
    if (model.FileReferences)
        throw new Error('CREATOR_MODEL_IMPORT_RUNTIME_UNSUPPORTED');
    if (typeof model.model !== 'string' || !/\.moc$/i.test(model.model) ||
        !Array.isArray(model.textures) || !model.textures.length)
        throw new Error('CREATOR_MODEL_IMPORT_MODEL_INVALID');
    const paths = new Set([entry]);
    const add = (ref, extensions) => {
        const p = modelImportReference(entry, ref);
        if (!extensions.test(p))
            throw new Error('CREATOR_MODEL_IMPORT_RESOURCE_UNSUPPORTED');
        paths.add(p);
    };
    add(model.model, /\.moc$/i);
    for (const texture of model.textures)
        add(texture, /\.(png|jpg|jpeg)$/i);
    // Cubism 2 settings treat exactly "" as an absent optional resource. Keep
    // malformed values and every nonempty reference subject to normal validation.
    for (const key of ['physics', 'pose'])
        if (model[key] !== undefined && model[key] !== '')
            add(model[key], /\.json$/i);
    if (model.expressions !== undefined) {
        if (!Array.isArray(model.expressions))
            throw new Error('CREATOR_MODEL_IMPORT_MODEL_INVALID');
        for (const expression of model.expressions)
            add(expression?.file, /\.json$/i);
    }
    if (model.motions !== undefined) {
        if (!model.motions || typeof model.motions !== 'object' || Array.isArray(model.motions))
            throw new Error('CREATOR_MODEL_IMPORT_MODEL_INVALID');
        for (const group of Object.values(model.motions)) {
            if (!Array.isArray(group))
                throw new Error('CREATOR_MODEL_IMPORT_MODEL_INVALID');
            for (const motion of group) {
                add(motion?.file, /\.mtn$/i);
                if (motion?.sound !== undefined && motion.sound !== '')
                    add(motion.sound, /\.(wav|mp3|ogg)$/i);
            }
        }
    }
    if (paths.size > MODEL_IMPORT_MAX_FILES)
        throw new Error('CREATOR_MODEL_IMPORT_TOO_LARGE');
    return [...paths].sort();
}
