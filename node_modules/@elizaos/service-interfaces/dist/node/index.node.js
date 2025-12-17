// src/interfaces/browser.ts
import { Service, ServiceType } from "@elizaos/core";

class IBrowserService extends Service {
  static serviceType = ServiceType.BROWSER;
  capabilityDescription = "Web browser automation and scraping capabilities";
}

// src/interfaces/email.ts
import { Service as Service2, ServiceType as ServiceType2 } from "@elizaos/core";

class IEmailService extends Service2 {
  static serviceType = ServiceType2.EMAIL;
  capabilityDescription = "Email sending, receiving, and management capabilities";
}

// src/interfaces/lp.ts
import { Service as Service3 } from "@elizaos/core";

class ILpService extends Service3 {
  static serviceType = "lp";
  capabilityDescription = "Provides standardized access to DEX liquidity pools.";
}

// src/interfaces/message.ts
import { Service as Service4, ServiceType as ServiceType3 } from "@elizaos/core";

class IMessageService extends Service4 {
  static serviceType = ServiceType3.MESSAGE;
  capabilityDescription = "Message sending, receiving, and management capabilities";
}

// src/interfaces/pdf.ts
import { Service as Service5, ServiceType as ServiceType4 } from "@elizaos/core";

class IPdfService extends Service5 {
  static serviceType = ServiceType4.PDF;
  capabilityDescription = "PDF processing, extraction, and generation capabilities";
}

// src/interfaces/post.ts
import { Service as Service6, ServiceType as ServiceType5 } from "@elizaos/core";

class IPostService extends Service6 {
  static serviceType = ServiceType5.POST;
  capabilityDescription = "Social media posting and content management capabilities";
}

// src/interfaces/token.ts
import { Service as Service7, ServiceType as ServiceType6 } from "@elizaos/core";

class ITokenDataService extends Service7 {
  static serviceType = ServiceType6.TOKEN_DATA;
  capabilityDescription = "Provides standardized access to token market data.";
}

// src/interfaces/transcription.ts
import { Service as Service8, ServiceType as ServiceType7 } from "@elizaos/core";

class ITranscriptionService extends Service8 {
  static serviceType = ServiceType7.TRANSCRIPTION;
  capabilityDescription = "Audio transcription and speech processing capabilities";
}

// src/interfaces/video.ts
import { Service as Service9, ServiceType as ServiceType8 } from "@elizaos/core";

class IVideoService extends Service9 {
  static serviceType = ServiceType8.VIDEO;
  capabilityDescription = "Video download, processing, and conversion capabilities";
}

// src/interfaces/wallet.ts
import { Service as Service10, ServiceType as ServiceType9 } from "@elizaos/core";

class IWalletService extends Service10 {
  static serviceType = ServiceType9.WALLET;
  capabilityDescription = "Provides standardized access to wallet balances and portfolios.";
}

// src/interfaces/web-search.ts
import { Service as Service11, ServiceType as ServiceType10 } from "@elizaos/core";

class IWebSearchService extends Service11 {
  static serviceType = ServiceType10.WEB_SEARCH;
  capabilityDescription = "Web search and content discovery capabilities";
}
export {
  IWebSearchService,
  IWalletService,
  IVideoService,
  ITranscriptionService,
  ITokenDataService,
  IPostService,
  IPdfService,
  IMessageService,
  ILpService,
  IEmailService,
  IBrowserService
};

//# debugId=57102F0D253FCB5764756E2164756E21
//# sourceMappingURL=index.node.js.map
