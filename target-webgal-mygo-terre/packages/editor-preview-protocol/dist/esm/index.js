export const EDITOR_PREVIEW_PROTOCOL_V1_SUBPROTOCOL = 'webgal-editor-preview-sync.v1';
export const SESSION_REGISTER_PREVIEW_TYPE = 'session.register-preview';
function payload() {
    return undefined;
}
function definePayloadMap(map) {
    return Object.freeze(map);
}
function messageTypes(map) {
    return Object.freeze(Object.keys(map));
}
export const COMPONENT_VISIBILITY_KEYS = [
    'showStarter',
    'showTitle',
    'showMenuPanel',
    'showTextBox',
    'showControls',
    'controlsVisibility',
    'showBacklog',
    'showExtra',
    'showGlobalDialog',
    'showPanicOverlay',
    'isEnterGame',
    'isShowLogo',
    'enableAppreciationMode',
    'fontOptimization',
];
export const PREVIEW_COMMAND_PAYLOADS = definePayloadMap({
    'preview.command.sync-scene': payload(),
    'preview.command.run-scene-content': payload(),
    'preview.command.run-snippet': payload(),
    'preview.command.reload-templates': payload(),
    'preview.command.set-effect': payload(),
    'preview.command.set-component-visibility': payload(),
    'preview.command.set-font-optimization': payload(),
    'preview.command.set-text-read-mode': payload(),
});
export const PREVIEW_COMMAND_TYPES = messageTypes(PREVIEW_COMMAND_PAYLOADS);
export const PREVIEW_QUERY_PAYLOADS = definePayloadMap({
    'preview.query.reference-box': payload(),
    'preview.query.base-transform': payload(),
    'preview.query.transform-baseline': payload(),
});
export const PREVIEW_QUERY_TYPES = messageTypes(PREVIEW_QUERY_PAYLOADS);
export const PREVIEW_REQUEST_TYPES = [
    ...PREVIEW_COMMAND_TYPES,
    ...PREVIEW_QUERY_TYPES,
];
export const HOST_EVENT_PAYLOADS = definePayloadMap({
    'preview.ready.updated': payload(),
    'stage.snapshot.updated': payload(),
    'preview.event.fast-preview-timeout': payload(),
});
export const HOST_EVENT_TYPES = messageTypes(HOST_EVENT_PAYLOADS);
export const SESSION_REQUEST_PAYLOADS = definePayloadMap({
    [SESSION_REGISTER_PREVIEW_TYPE]: payload(),
});
export const SESSION_REQUEST_TYPES = messageTypes(SESSION_REQUEST_PAYLOADS);
export const REQUEST_TYPES = [
    ...SESSION_REQUEST_TYPES,
    ...PREVIEW_REQUEST_TYPES,
];
export const PREVIEW_QUERY_RESPONSE_PAYLOADS = definePayloadMap({
    'preview.query.reference-box': payload(),
    'preview.query.base-transform': payload(),
    'preview.query.transform-baseline': payload(),
});
export const PREVIEW_RESPONSE_TYPES = PREVIEW_REQUEST_TYPES;
export const SESSION_RESPONSE_PAYLOADS = definePayloadMap({
    [SESSION_REGISTER_PREVIEW_TYPE]: payload(),
});
export const SESSION_RESPONSE_TYPES = messageTypes(SESSION_RESPONSE_PAYLOADS);
export const RESPONSE_TYPES = [
    ...SESSION_RESPONSE_TYPES,
    ...PREVIEW_RESPONSE_TYPES,
];
export const PREVIEW_REQUEST_ERROR_CODES = ['bad-request', 'unsupported-request-type', 'internal-error'];
export function createEventEnvelope(type, payload) {
    return {
        kind: 'event',
        type,
        payload,
    };
}
export function createRequestEnvelope(type, requestId, payload) {
    return {
        kind: 'request',
        type,
        requestId,
        payload,
    };
}
export function createResponseEnvelope(type, requestId, payload) {
    return {
        kind: 'response',
        type,
        requestId,
        payload,
    };
}
export function createRequestErrorEnvelope(type, requestId, error) {
    return {
        kind: 'error',
        type,
        requestId,
        error,
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function hasPayloadEnvelopeShape(value, kind) {
    return (isRecord(value) &&
        value.kind === kind &&
        typeof value.type === 'string' &&
        'payload' in value &&
        (kind === 'event' || typeof value.requestId === 'string'));
}
function isMessageType(value, acceptedTypes) {
    return typeof value === 'string' && acceptedTypes.includes(value);
}
export function isSessionRequestType(value) {
    return isMessageType(value, SESSION_REQUEST_TYPES);
}
export function isPreviewCommandType(value) {
    return isMessageType(value, PREVIEW_COMMAND_TYPES);
}
export function isPreviewQueryType(value) {
    return isMessageType(value, PREVIEW_QUERY_TYPES);
}
export function isPreviewRequestType(value) {
    return isMessageType(value, PREVIEW_REQUEST_TYPES);
}
export function isRequestType(value) {
    return isMessageType(value, REQUEST_TYPES);
}
export function isPreviewResponseType(value) {
    return isMessageType(value, PREVIEW_RESPONSE_TYPES);
}
export function isSessionResponseType(value) {
    return isMessageType(value, SESSION_RESPONSE_TYPES);
}
export function isResponseType(value) {
    return isMessageType(value, RESPONSE_TYPES);
}
export function isHostEventType(value) {
    return isMessageType(value, HOST_EVENT_TYPES);
}
export function isPreviewRequestErrorCode(value) {
    return isMessageType(value, PREVIEW_REQUEST_ERROR_CODES);
}
export function isEventEnvelope(value) {
    return hasPayloadEnvelopeShape(value, 'event');
}
export function isRequestEnvelope(value) {
    return hasPayloadEnvelopeShape(value, 'request');
}
export function isResponseEnvelope(value) {
    return hasPayloadEnvelopeShape(value, 'response');
}
export function isPreviewRequestErrorEnvelope(value) {
    return (isRecord(value) &&
        value.kind === 'error' &&
        typeof value.type === 'string' &&
        typeof value.requestId === 'string' &&
        isRecord(value.error) &&
        isPreviewRequestErrorCode(value.error.code) &&
        (!('message' in value.error) || typeof value.error.message === 'string'));
}
export function isAnyProtocolEnvelope(value) {
    return (isEventEnvelope(value) ||
        isRequestEnvelope(value) ||
        isResponseEnvelope(value) ||
        isPreviewRequestErrorEnvelope(value));
}
export function isHostEventEnvelope(value) {
    return isEventEnvelope(value) && isHostEventType(value.type);
}
export function isKnownRequestEnvelope(value) {
    return isRequestEnvelope(value) && isRequestType(value.type);
}
export function isSessionRequestEnvelope(value) {
    return isRequestEnvelope(value) && isSessionRequestType(value.type);
}
export function isPreviewCommandRequestEnvelope(value) {
    return isRequestEnvelope(value) && isPreviewCommandType(value.type);
}
export function isPreviewRequestEnvelope(value) {
    return isRequestEnvelope(value) && isPreviewRequestType(value.type);
}
export function isKnownResponseEnvelope(value) {
    return isResponseEnvelope(value) && isResponseType(value.type);
}
export function isPreviewResponseEnvelope(value) {
    return isResponseEnvelope(value) && isPreviewResponseType(value.type);
}
export function isKnownPreviewRequestErrorEnvelope(value) {
    return isPreviewRequestErrorEnvelope(value) && isPreviewRequestType(value.type);
}
export function isKnownProtocolEnvelope(value) {
    return (isHostEventEnvelope(value) ||
        isKnownRequestEnvelope(value) ||
        isKnownResponseEnvelope(value) ||
        (isPreviewRequestErrorEnvelope(value) && isRequestType(value.type)));
}
