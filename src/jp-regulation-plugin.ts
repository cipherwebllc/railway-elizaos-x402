import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  Service,
  type State,
  logger,
} from '@elizaos/core';

/**
 * Japan Regulation Service
 * Provides information on Japanese crypto regulations, tax laws, and compliance
 */
export class JapanRegulationService extends Service {
  static serviceType = 'jp-regulation';

  capabilityDescription = 'Provides Japanese cryptocurrency regulation and tax information';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('*** Starting Japan Regulation service ***');
    const service = new JapanRegulationService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** Stopping Japan Regulation service ***');
    const service = runtime.getService(JapanRegulationService.serviceType);
    if (service) {
      service.stop();
    }
  }

  async stop() {
    logger.info('*** Stopping Japan Regulation service instance ***');
  }

  /**
   * 免責事項テンプレート
   */
  getDisclaimer(): string {
    return `\n\n---\n⚠️ **免責事項**: 本情報は公的資料の要約であり、税務・法務アドバイスではありません。最終判断は税理士・弁護士にご相談ください。`;
  }

  /**
   * Get current crypto tax rates and rules in Japan
   * 出典: 国税庁タックスアンサー、国税庁FAQ
   */
  getCryptoTaxInfo(): any {
    return {
      個人: {
        区分: '雑所得（総合課税）',
        税率: {
          説明: '累進課税（所得税 + 住民税）',
          最低: '15%（所得195万円以下）',
          最高: '55%（所得4000万円超）',
        },
        損益通算: '不可（他の雑所得とのみ通算可能）',
        繰越控除: '不可',
        特定口座: '利用不可',
        注意点: [
          '年間取引報告書の作成が必要',
          '移動平均法または総平均法で計算',
          '暗号資産の期末評価（活発な市場が存在する場合は時価評価）',
          '20万円以下の雑所得は確定申告不要（給与所得者のみ）',
        ],
        出典: [
          { 番号: 'No.1524', タイトル: '暗号資産を売却又は使用した場合', URL: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1524.htm' },
          { 番号: 'No.1525', タイトル: '暗号資産取引に係る所得の計算方法', URL: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1525.htm' },
          { 番号: '国税庁FAQ', タイトル: '暗号資産に関する税務上の取扱いについて（FAQ）', URL: 'https://www.nta.go.jp/publication/pamph/pdf/virtual_currency_faq_03.pdf' },
        ],
      },
      法人: {
        区分: '事業所得',
        税率: {
          説明: '法人税 + 地方法人税 + 事業税 + 住民税',
          実効税率: '約29.74%（資本金1億円超）/ 約33.58%（中小法人）',
        },
        損益通算: '可能（事業所得として他の所得と通算）',
        繰越控除: '可能（最大10年間）',
        期末時価評価: {
          対象: '活発な市場が存在する暗号資産',
          例外: '令和5年度税制改正により、自己発行・継続保有の暗号資産は時価評価対象外',
        },
        注意点: [
          '期末に保有する暗号資産は原則時価評価',
          '自己発行トークンは一定条件下で時価評価対象外（令和5年改正）',
          '暗号資産の種類ごとに移動平均法または総平均法で計算',
        ],
        出典: [
          { 番号: '法人税法第61条', タイトル: '短期売買商品等の譲渡損益及び時価評価損益', URL: 'https://elaws.e-gov.go.jp/document?lawid=340AC0000000034' },
          { 番号: '令和5年度税制改正', タイトル: '暗号資産の期末時価評価の見直し', URL: 'https://www.mof.go.jp/tax_policy/tax_reform/outline/fy2023/explanation/index.html' },
        ],
      },
      更新日: '2025年1月現在',
    };
  }

  /**
   * Get JVCEA (Japan Virtual Currency Exchange Association) guidelines
   */
  getJVCEAGuidelines(): any {
    return {
      協会名: '一般社団法人日本暗号資産取引業協会（JVCEA）',
      役割: '自主規制団体',
      主要ガイドライン: [
        {
          項目: 'ステーブルコイン',
          内容: '電子決済手段としての規制（2023年6月施行）',
          詳細: '発行者は銀行、資金移動業者、信託会社に限定',
        },
        {
          項目: 'カストディ業務',
          内容: '暗号資産の預かり・管理に関する規制',
          詳細: 'コールドウォレット管理、分別管理の義務化',
        },
        {
          項目: 'レバレッジ取引',
          内容: '証拠金倍率の制限',
          詳細: '最大2倍まで（2021年5月より）',
        },
        {
          項目: '顧客資産の分別管理',
          内容: '信託銀行への信託または同等の方法',
          詳細: '顧客資産と自己資産の明確な分離',
        },
      ],
      更新日: '2025年1月現在',
    };
  }

  /**
   * Get Financial Services Agency (FSA) regulations
   */
  getFSARegulations(): any {
    return {
      規制当局: '金融庁（Financial Services Agency）',
      主要規制: [
        {
          法律: '資金決済法',
          施行日: '2017年4月（改正：2020年5月、2023年6月）',
          内容: [
            '暗号資産交換業者の登録制',
            '暗号資産の定義の明確化',
            'ICO規制（第一項有価証券とみなされる場合）',
            '電子決済手段（ステーブルコイン）の規制',
          ],
        },
        {
          法律: '金融商品取引法',
          施行日: '2020年5月改正施行',
          内容: [
            '暗号資産デリバティブ取引の規制',
            '第一種金融商品取引業の登録が必要',
            'セキュリティトークンの規制',
          ],
        },
        {
          法律: '犯罪収益移転防止法',
          内容: [
            'KYC（本人確認）の義務化',
            '疑わしい取引の届出義務',
            '取引時確認の厳格化',
          ],
        },
      ],
      最新トピック: [
        {
          日付: '2023年6月',
          内容: 'ステーブルコイン規制の施行',
          詳細: '電子決済手段としての法的位置づけの明確化',
        },
        {
          日付: '2024年12月',
          内容: 'DAOとweb3に関するガイドライン検討',
          詳細: '分散型組織の法的位置づけの整理',
        },
      ],
      更新日: '2025年1月現在',
    };
  }

  /**
   * Get all regulation information
   */
  getAllRegulationInfo(): any {
    return {
      税制情報: this.getCryptoTaxInfo(),
      JVCEA自主規制: this.getJVCEAGuidelines(),
      金融庁規制: this.getFSARegulations(),
    };
  }
}

/**
 * Get Japan Regulation Info Action
 * Provides Japanese crypto regulation and tax information
 */
const getJapanRegulationAction: Action = {
  name: 'GET_JP_REGULATION',
  similes: ['TAX_INFO', 'REGULATION', 'FSA', 'JVCEA', 'COMPLIANCE', 'LAW'],
  description:
    'IMPORTANT: Use this action when the user asks about Japanese cryptocurrency taxes, regulations, FSA rules, JVCEA guidelines, or legal compliance in Japan. This provides comprehensive regulatory information.',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const text = message.content.text.toLowerCase();

    const regulationKeywords = [
      'tax',
      'regulation',
      'fsa',
      'jvcea',
      'law',
      'legal',
      'compliance',
      '税',
      '税金',
      '税制',
      '規制',
      '金融庁',
      '法律',
      'コンプライアンス',
      '確定申告',
      '雑所得',
    ];
    const japanKeywords = ['japan', 'japanese', 'jp', '日本', '国内'];

    const hasRegulationKeyword = regulationKeywords.some((keyword) => text.includes(keyword));
    const hasJapanContext =
      japanKeywords.some((keyword) => text.includes(keyword)) || hasRegulationKeyword;

    const isRegulationQuery = hasRegulationKeyword && hasJapanContext;

    if (isRegulationQuery) {
      logger.info(`[GET_JP_REGULATION] Validate returned TRUE for: "${message.content.text}"`);
    }

    return isRegulationQuery;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Handling GET_JP_REGULATION action');

      const service = runtime.getService<JapanRegulationService>('jp-regulation');

      if (!service) {
        throw new Error('Japan Regulation service not available');
      }

      const text = message.content.text.toLowerCase();

      // Determine which information to provide based on query
      let responseText = '';
      let data: any = {};

      if (text.includes('税') || text.includes('tax') || text.includes('確定申告') || text.includes('雑所得')) {
        // Tax information
        const taxInfo = service.getCryptoTaxInfo();
        data = { tax: taxInfo };

        responseText = `📋 **要約**: 日本の暗号資産税制について\n\n`;
        responseText += `## 個人の場合\n`;
        responseText += `- **区分**: ${taxInfo.個人.区分}\n`;
        responseText += `- **税率**: ${taxInfo.個人.税率.最低} 〜 ${taxInfo.個人.税率.最高}\n`;
        responseText += `- **損益通算**: ${taxInfo.個人.損益通算}\n`;
        responseText += `- **繰越控除**: ${taxInfo.個人.繰越控除}\n\n`;

        responseText += `## 法人の場合\n`;
        responseText += `- **区分**: ${taxInfo.法人.区分}\n`;
        responseText += `- **実効税率**: ${taxInfo.法人.税率.実効税率}\n`;
        responseText += `- **損益通算**: ${taxInfo.法人.損益通算}\n`;
        responseText += `- **繰越控除**: ${taxInfo.法人.繰越控除}\n`;
        if (taxInfo.法人.期末時価評価) {
          responseText += `- **期末時価評価**: ${taxInfo.法人.期末時価評価.例外}\n`;
        }

        // 出典セクション
        responseText += `\n---\n📚 **出典・根拠**\n`;
        taxInfo.個人.出典.forEach((source: any) => {
          responseText += `- 国税庁「${source.タイトル}」(${source.番号})\n`;
        });
        taxInfo.法人.出典.forEach((source: any) => {
          responseText += `- ${source.タイトル}（${source.番号}）\n`;
        });

        // 免責事項
        responseText += service.getDisclaimer();
      } else if (text.includes('jvcea') || text.includes('自主規制')) {
        // JVCEA guidelines
        const jvceaInfo = service.getJVCEAGuidelines();
        data = { jvcea: jvceaInfo };

        responseText = `📋 **要約**: JVCEA自主規制ガイドライン\n\n`;
        jvceaInfo.主要ガイドライン.forEach((guideline: any) => {
          responseText += `## ${guideline.項目}\n`;
          responseText += `**${guideline.内容}**\n`;
          responseText += `${guideline.詳細}\n\n`;
        });

        responseText += `---\n📚 **出典・根拠**\n`;
        responseText += `- JVCEA「自主規制規則」 https://jvcea.or.jp/about/document/\n`;
        responseText += service.getDisclaimer();

      } else if (text.includes('fsa') || text.includes('金融庁') || text.includes('資金決済法')) {
        // FSA regulations
        const fsaInfo = service.getFSARegulations();
        data = { fsa: fsaInfo };

        responseText = `📋 **要約**: 金融庁（FSA）規制\n\n`;
        fsaInfo.主要規制.forEach((regulation: any) => {
          responseText += `## ${regulation.法律}\n`;
          if (regulation.施行日) {
            responseText += `施行日: ${regulation.施行日}\n`;
          }
          regulation.内容.forEach((item: string) => {
            responseText += `- ${item}\n`;
          });
          responseText += `\n`;
        });

        responseText += `**最新トピック**:\n`;
        fsaInfo.最新トピック.forEach((topic: any) => {
          responseText += `- **${topic.日付}**: ${topic.内容}\n`;
        });

        responseText += `\n---\n📚 **出典・根拠**\n`;
        responseText += `- 金融庁「暗号資産（仮想通貨）」 https://www.fsa.go.jp/policy/virtual_currency/index.html\n`;
        responseText += `- e-Gov法令検索「資金決済に関する法律」 https://elaws.e-gov.go.jp/\n`;
        responseText += service.getDisclaimer();

      } else {
        // General regulation overview
        const allInfo = service.getAllRegulationInfo();
        data = allInfo;

        responseText = `📋 **要約**: 日本の暗号資産規制概要\n\n`;
        responseText += `## 税制\n`;
        responseText += `- 個人: ${allInfo.税制情報.個人.税率.最低} 〜 ${allInfo.税制情報.個人.税率.最高}（雑所得・総合課税）\n`;
        responseText += `- 法人: ${allInfo.税制情報.法人.税率.実効税率}\n\n`;

        responseText += `## 主要規制当局\n`;
        responseText += `- 金融庁（FSA）: 資金決済法・金融商品取引法を所管\n`;
        responseText += `- JVCEA: 暗号資産交換業の自主規制団体\n\n`;

        responseText += `詳しい情報は「税制」「金融庁」「JVCEA」で質問してください。\n`;

        responseText += `\n---\n📚 **出典・根拠**\n`;
        responseText += `- 国税庁タックスアンサー（暗号資産）\n`;
        responseText += `- 金融庁「暗号資産関連」ページ\n`;
        responseText += service.getDisclaimer();
      }

      const responseContent: Content = {
        text: responseText,
        actions: ['GET_JP_REGULATION'],
        source: message.content.source,
      };

      await callback(responseContent);

      return {
        text: 'Successfully retrieved Japan regulation information',
        values: {
          success: true,
        },
        data: {
          actionName: 'GET_JP_REGULATION',
          messageId: message.id,
          timestamp: Date.now(),
          regulation: data,
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in GET_JP_REGULATION action');

      const errorMessage = error instanceof Error ? error.message : String(error);

      await callback({
        text: `規制情報の取得に失敗しました: ${errorMessage}`,
        source: message.content.source,
      });

      return {
        text: 'Failed to get regulation information',
        values: {
          success: false,
          error: errorMessage,
        },
        data: {
          actionName: 'GET_JP_REGULATION',
          error: errorMessage,
        },
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  },

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: '日本の暗号資産の税金について教えて',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '📊 **日本の暗号資産税制**\n\n## 個人の場合\n- **区分**: 雑所得（総合課税）\n- **税率**: 15% 〜 55%\n- **損益通算**: 不可\n- **繰越控除**: 不可',
          actions: ['GET_JP_REGULATION'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: '金融庁の暗号資産規制は？',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '🏛️ **金融庁（FSA）規制**\n\n## 資金決済法\n施行日: 2017年4月\n- 暗号資産交換業者の登録制\n- 暗号資産の定義の明確化',
          actions: ['GET_JP_REGULATION'],
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'JVCEAのガイドラインについて',
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: '🏛️ **JVCEA（日本暗号資産取引業協会）ガイドライン**\n\n## ステーブルコイン\n**電子決済手段としての規制（2023年6月施行）**\n発行者は銀行、資金移動業者、信託会社に限定',
          actions: ['GET_JP_REGULATION'],
        },
      },
    ],
  ],
};

/**
 * Japan Regulation Plugin
 * Provides Japanese cryptocurrency regulation and tax information
 */
export const japanRegulationPlugin: Plugin = {
  name: 'jp-regulation',
  description: 'Japanese cryptocurrency regulation and tax information',
  services: [JapanRegulationService],
  actions: [getJapanRegulationAction],
};

export default japanRegulationPlugin;
