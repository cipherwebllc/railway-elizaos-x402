export const ERC8004_SERVICE_NAME = 'ERC8004_SERVICE';

export const DEFAULT_CHAIN_ID = 8453; // Base mainnet
export const SUPPORTED_CHAINS = {
    ANVIL: 31337,
    BASE_MAINNET: 8453,
    BASE_SEPOLIA: 84532,
    ETHEREUM_MAINNET: 1,
    ETHEREUM_SEPOLIA: 11155111,
} as const;

export const DEFAULT_RPC_URLS: Record<number, string> = {
    [SUPPORTED_CHAINS.ANVIL]: 'http://localhost:8545',
    [SUPPORTED_CHAINS.BASE_MAINNET]: 'https://mainnet.base.org',
    [SUPPORTED_CHAINS.BASE_SEPOLIA]: 'https://sepolia.base.org',
    [SUPPORTED_CHAINS.ETHEREUM_MAINNET]: 'https://eth.llamarpc.com',
    [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: 'https://rpc.sepolia.org',
};

// ERC-8004 Contract ABI - core functions
export const ERC8004_ABI = [
    // Agent Registration
    'function registerAgent(string memory agentId, string memory name, string memory domain) external',
    'function updateAgent(string memory agentId, string memory name, string memory domain) external',
    'function deactivateAgent(string memory agentId) external',

    // Agent Information
    'function getAgent(string memory agentId) external view returns (address owner, string name, string domain, bool active, uint256 reputation, uint256 lastUpdate)',
    'function isAgentActive(string memory agentId) external view returns (bool)',
    'function getAgentReputation(string memory agentId) external view returns (uint256)',

    // Reputation Management
    'function endorseAgent(string memory agentId, uint256 amount) external',
    'function penalizeAgent(string memory agentId, uint256 amount) external',
    'function reportAgent(string memory agentId, string memory reason) external',

    // Events
    'event AgentRegistered(string indexed agentId, address indexed owner, string name, string domain)',
    'event AgentUpdated(string indexed agentId, string name, string domain)',
    'event AgentDeactivated(string indexed agentId)',
    'event AgentEndorsed(string indexed agentId, address indexed endorser, uint256 amount)',
    'event AgentPenalized(string indexed agentId, address indexed penalizer, uint256 amount)',
    'event AgentReported(string indexed agentId, address indexed reporter, string reason)',
] as const;

export const CACHE_KEYS = {
    AGENT_INFO: 'erc8004:agent:info',
    REPUTATION: 'erc8004:reputation',
    ACTIVE_STATUS: 'erc8004:active',
    GLOBAL_REGISTRIES: 'erc8004:global:registries',
} as const;

export const CACHE_TTL = {
    AGENT_INFO: 300, // 5 minutes
    REPUTATION: 60, // 1 minute
    ACTIVE_STATUS: 120, // 2 minutes
} as const;

// Default ERC-8004 registries
// Note: Plugins like plugin-babylon will register their registries dynamically
export const DEFAULT_REGISTRIES: Array<{
    id: string;
    name: string;
    chainId: number;
    contractAddress: string;
    rpcUrl?: string;
    isDefault: boolean;
    handlerType?: string;
}> = [];

