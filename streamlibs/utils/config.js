/* eslint-disable import/prefer-default-export */
export const CONFIG = {
  locales: {
    '': { ietf: 'en-US', tk: 'hah7vzn.css' },
    de: { ietf: 'de-DE', tk: 'hah7vzn.css' },
    kr: { ietf: 'ko-KR', tk: 'zfo3ouc' },
  },
  figmaServiceRetry: {
    retryCount: 3,
    retryDelaysMs: [1000, 2000, 4000, 6000],
    blockContentConcurrency: 3,
  },
  prod: {
    streamMapper: {
      serviceEP: 'https://adobe-acom-stream-service-deploy-ethos501-prod-or2-ab8ae6.cloud.adobe.io',
      figmaMappingUrl: '/api/fig-comps',
      figmaBlockContentUrl: '/api/fig-comp-details',
      pushToDaUrl: '/api/push-html',
      blockMappingsUrl: 'https://main--stream-mapper--adobecom.aem.live/block-mappings',
      figmaAuthToken: '',
      daToken: '',
      preflightUrl: '/drafts/stream/tools/preflight-controller?milolibs=stream-prod',
      sidekickLoginUrl: '/drafts/stream/tools/sidekick-controller?milolibs=stream-prod',
      allowMessagesFromDomains: ['https://440859-stream.adobeio-static.net'],
    },
  },
  stage: {
    streamMapper: {
      serviceEP: 'https://adobe-acom-stream-service-deploy-ethos501-prod-or2-d587ab.cloud.adobe.io',
      figmaMappingUrl: '/api/fig-comps',
      figmaBlockContentUrl: '/api/fig-comp-details',
      pushToDaUrl: '/api/push-html',
      blockMappingsUrl: 'https://stage--stream-mapper--adobecom.aem.page/block-mappings',
      figmaAuthToken: '',
      daToken: '',
      preflightUrl: '/drafts/stream/tools/preflight-controller?milolibs=stream-stage',
      sidekickLoginUrl: '/drafts/stream/tools/sidekick-controller?milolibs=stream-stage',
      allowMessagesFromDomains: ['https://440859-stream*.adobeio-static.net'],
    },
  },
  dev: {
    streamMapper: {
      serviceEP: 'http://localhost:8082',
      figmaMappingUrl: '/api/fig-comps',
      figmaBlockContentUrl: '/api/fig-comp-details',
      pushToDaUrl: '/api/push-html',
      blockMappingsUrl: 'https://stage--stream-mapper--adobecom.aem.page/block-mappings',
      figmaAuthToken: '',
      daToken: '',
      preflightUrl: '/drafts/stream/tools/preflight-controller?milolibs=stream-dev',
      sidekickLoginUrl: '/drafts/stream/tools/sidekick-controller?milolibs=stream-dev',
      allowMessagesFromDomains: ['*', 'https://440859-stream*.adobeio-static.net'],
    },
  },
  dev02: {
    streamMapper: {
      serviceEP: 'http://localhost:8082',
      figmaMappingUrl: '/api/fig-comps',
      figmaBlockContentUrl: '/api/fig-comp-details',
      pushToDaUrl: '/api/push-html',
      blockMappingsUrl: 'https://stage--stream-mapper--adobecom.aem.page/block-mappings',
      figmaAuthToken: '',
      daToken: '',
      preflightUrl: '/drafts/stream/tools/preflight-controller?milolibs=stream-dev',
      sidekickLoginUrl: '/drafts/stream/tools/sidekick-controller?milolibs=stream-dev',
      allowMessagesFromDomains: ['*', 'https://440859-stream*.adobeio-static.net'],
    },
  },
};
