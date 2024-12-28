# PowerloomNodes Contract Documentation

## Table of Contents
- [PowerloomNodes Contract Documentation](#powerloomnodes-contract-documentation)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Key Features](#key-features)
  - [Detailed Function Documentation](#detailed-function-documentation)
    - [Initialization and Setup](#initialization-and-setup)
      - [`initialize(address initialOwner, uint256 initialNodePrice, string memory initialName)`](#initializeaddress-initialowner-uint256-initialnodeprice-string-memory-initialname)
      - [`configureLegacyNodes(...)`](#configurelegacynodes)
    - [Node Minting and Management](#node-minting-and-management)
      - [`mintNode(uint256 amount)`](#mintnodeuint256-amount)
      - [`adminMintLegacyNodes(address _to, uint256 _amount, bool _isKyced)`](#adminmintlegacynodesaddress-_to-uint256-_amount-bool-_iskyced)
      - [`burnNode(uint256 _nodeId)`](#burnnodeuint256-_nodeid)
    - [Snapshotter Management](#snapshotter-management)
      - [`assignSnapshotterToNode(uint256 nodeId, address snapshotterAddress)`](#assignsnapshottertonodeuint256-nodeid-address-snapshotteraddress)
    - [Token Claims](#token-claims)
      - [`claimableNodeTokens(uint256 _nodeId)`](#claimablenodetokensuint256-_nodeid)
      - [`assignSnapshotterToNodeAdmin(uint256 nodeId, address snapshotterAddress)`](#assignsnapshottertonodeadminuint256-nodeid-address-snapshotteraddress)
      - [`claimNodeTokens(uint256 _nodeId)`](#claimnodetokensuint256-_nodeid)
      - [`vestedLegacyNodeTokens()`](#vestedlegacynodetokens)
    - [Administrative Functions](#administrative-functions)
      - [`updateAdmins(address[] calldata _admins, bool[] calldata _status)`](#updateadminsaddress-calldata-_admins-bool-calldata-_status)
      - [`emergencyWithdraw()`](#emergencywithdraw)
      - [`pause()` / `unpause()`](#pause--unpause)
  - [Events in Detail](#events-in-detail)
    - [Node Management Events](#node-management-events)
    - [Token Claim Events](#token-claim-events)
    - [Configuration and State Events](#configuration-and-state-events)
    - [Administrative Events](#administrative-events)
  - [Value Flow and Economics](#value-flow-and-economics)
    - [Regular Nodes](#regular-nodes)
    - [Legacy Nodes](#legacy-nodes)
  - [Security Model](#security-model)
    - [Access Control Layers](#access-control-layers)
    - [Value Protection](#value-protection)
  - [Dependencies and Inheritance](#dependencies-and-inheritance)
  - [Upgrade Considerations](#upgrade-considerations)


## Overview
PowerloomNodes is a Soul Bound Token (SBT) contract that manages Powerloom Snapshotter Nodes. It implements ERC1155 with non-transferability, making tokens bound to their owners. The contract supports both regular and legacy node types, with different vesting and claiming mechanisms.

## Key Features
- Non-transferable ERC1155 tokens (SBT)
- Upgradeable using UUPS pattern
- Pausable for emergency situations
- Supports both regular and legacy nodes
- Token vesting mechanism for legacy nodes
- KYC-dependent functionality
- Admin management system
- Snapshotter address management

## Detailed Function Documentation

### Initialization and Setup

#### `initialize(address initialOwner, uint256 initialNodePrice, string memory initialName)`
- Purpose: Initializes the contract with basic parameters
- Parameters:
  - `initialOwner`: Address that will have owner privileges
  - `initialNodePrice`: Starting price for minting regular nodes
  - `initialName`: Name of the token contract
- Behavior: 
  - Initializes all OpenZeppelin components (ERC1155, Ownable, Pausable, etc.)
  - Sets initial node price
  - Sets contract name

#### `configureLegacyNodes(...)`
- Purpose: Configures all parameters for legacy node functionality
- Parameters:
  - `_legacyNodeCount`: Maximum number of legacy nodes
  - `_legacyNodeInitialClaimPercentage`: Initial claim percentage (in ppm, 1e6 = 100%)
  - `_legacyNodeCliff`: Vesting cliff period in days
  - `_legacyNodeValue`: Total value per legacy node
  - `_legacyNodeVestingDays`: Total vesting duration
  - `_legacyNodeVestingStart`: Vesting start timestamp
  - `_legacyTokensSentOnL1`: Tokens already distributed on L1
  - `_legacyNodeNonKycedCooldown`: Cooldown for non-KYCed nodes
- Behavior:
  - Sets all legacy node parameters
  - Validates input values (e.g., percentage ≤ 100%)
  - Emits `ConfigurationUpdated` event

### Node Minting and Management

#### `mintNode(uint256 amount)`
- Purpose: Allows users to mint regular nodes
- Parameters:
  - `amount`: Number of nodes to mint
- Requirements:
  - Contract must not be paused
  - Minting must be open (current time ≥ mintStartTime)
  - Sufficient ETH sent (amount * nodePrice)
- Behavior:
  - Creates new nodes
  - Assigns ownership
  - Refunds excess ETH
  - Updates state variables
  - Emits `NodeMinted` events

#### `adminMintLegacyNodes(address _to, uint256 _amount, bool _isKyced)`
- Purpose: Admin function to mint legacy nodes
- Parameters:
  - `_to`: Recipient address
  - `_amount`: Number of nodes
  - `_isKyced`: KYC status of recipient
- Requirements:
  - Only owner can call
  - Must be within legacyNodeCount limit
- Behavior:
  - Mints legacy nodes with special properties
  - Sets KYC status
  - Updates legacy node tracking
  - Emits `NodeMinted` events

#### `burnNode(uint256 _nodeId)`
- Purpose: Burns a node and initiates token claiming process
- Parameters:
  - `_nodeId`: ID of node to burn
- Requirements:
  - Caller must be node owner
  - Contract must not be paused
- Behavior:
  - Burns the node token
  - Updates burning tracking
  - For legacy nodes:
    - If KYCed: Initiates vesting schedule
    - If non-KYCed: Enables one-time claim after cooldown
  - Emits `NodeBurned` event

### Snapshotter Management

#### `assignSnapshotterToNode(uint256 nodeId, address snapshotterAddress)`
- Purpose: Assigns a snapshotter address to a node
- Parameters:
  - `nodeId`: Target node ID
  - `snapshotterAddress`: Address to assign
- Requirements:
  - Caller must be node owner
  - Must respect cooldown period
- Behavior:
  - Updates snapshotter mapping
  - Updates node active status
  - Updates enabled node count
  - Emits `allSnapshottersUpdated` event

- Purpose: Admin version of snapshotter assignment
- Behavior: Same as `assignSnapshotterToNode` but bypasses cooldown

### Token Claims

#### `claimableNodeTokens(uint256 _nodeId)`
- Purpose: Calculates claimable tokens for a node
- Parameters:
  - `_nodeId`: Node ID to check
- Returns: Amount of tokens claimable
- Behavior:
  - For regular nodes:
    - Returns node price if cooldown passed
  - For legacy nodes:
    - KYCed: Calculates vested amount
    - Non-KYCed: Returns full amount if cooldown passed

#### `assignSnapshotterToNodeAdmin(uint256 nodeId, address snapshotterAddress)`
- Purpose: Admin version of snapshotter assignment
- Behavior: Same as `assignSnapshotterToNode` but bypasses cooldown


#### `claimNodeTokens(uint256 _nodeId)`
- Purpose: Claims available tokens for a node
- Requirements:
  - Node must be burned
  - Appropriate cooldown must have passed
  - Tokens must not be already claimed
- Behavior:
  - Transfers claimable tokens
  - Updates claim status
  - Emits appropriate claim event

#### `vestedLegacyNodeTokens()`
- Purpose: Calculates total vested tokens for legacy nodes
- Behavior:
  - Considers vesting schedule
  - Accounts for cliff period
  - Uses precision factor for accurate calculations

### Administrative Functions

#### `updateAdmins(address[] calldata _admins, bool[] calldata _status)`
- Purpose: Manages admin privileges
- Parameters:
  - `_admins`: Array of admin addresses
  - `_status`: Array of boolean statuses
- Behavior:
  - Adds/removes admin privileges
  - Emits `AdminsUpdated` events

#### `emergencyWithdraw()`
- Purpose: Allows owner to withdraw all funds in emergencies
- Behavior:
  - Transfers all contract balance to owner
  - Emits `EmergencyWithdraw` event

#### `pause()` / `unpause()`
- Purpose: Emergency pause/unpause of contract functions
- Behavior:
  - Stops/resumes critical operations
  - Affects minting, burning, claiming

## Events in Detail

### Node Management Events
1. `NodeMinted(address indexed to, uint256 nodeId)`
   - Triggered when: New node is minted (both regular and legacy)
   - Use case: Track node creation and ownership assignment

2. `NodeBurned(address indexed from, uint256 nodeId)`
   - Triggered when: Node is burned by its owner
   - Use case: Track node retirement and start of claim eligibility period

### Token Claim Events
1. `LegacyNodeTokensClaimed(address indexed claimer, uint256 nodeId, uint256 amount)`
   - Triggered when: Legacy node tokens are claimed (both KYCed and non-KYCed)
   - Use case: Track token claims for legacy nodes

2. `SnapshotterTokensClaimed(address indexed claimer, uint256 nodeId, uint256 amount)`
   - Triggered when: Regular node tokens are claimed
   - Use case: Track token claims for regular nodes

### Configuration and State Events
1. `ConfigurationUpdated(string paramName, uint256 newValue)`
   - Triggered when: Contract configuration parameters are updated
   - Use case: Audit trail of parameter changes (e.g., node price, cooldown periods)

2. `URIUpdated(string newUri)`
   - Triggered when: Token metadata URI is updated
   - Use case: Track changes to token metadata location

3. `NameUpdated(string newName)`
   - Triggered when: Contract name is updated
   - Use case: Track contract name changes

4. `SnapshotterStateUpdated(address indexed newSnapshotterState)`
   - Triggered when: Snapshotter state changes
   - Use case: Monitor snapshotter state modifications

5. `allSnapshottersUpdated(address snapshotterAddress, bool allowed)`
   - Triggered when: Snapshotter permissions are modified
   - Use case: Track changes in snapshotter access rights

### Administrative Events
1. `AdminsUpdated(address adminAddress, bool allowed)`
   - Triggered when: Admin role permissions are modified
   - Use case: Track changes in administrative access

2. `EmergencyWithdraw(address indexed owner, uint256 amount)`
   - Triggered when: Emergency withdrawal is executed by owner
   - Use case: Monitor emergency fund withdrawals

3. `Deposit(address indexed from, uint256 amount)`
   - Triggered when: ETH is deposited into the contract
   - Use case: Track incoming funds

## Value Flow and Economics

### Regular Nodes
1. **Minting**
   - User pays `nodePrice` in $POWER
   - Contract holds funds
   - Node is minted as SBT

2. **Claiming**
   - User burns node
   - Waits for `snapshotterTokenClaimCooldown`
   - Claims original `nodePrice`

### Legacy Nodes
1. **Minting**
   - Admin mints with KYC status
   - No immediate payment
   - Node value is `legacyNodeValue`

2. **Claiming (KYCed)**
   - Initial claim: `legacyNodeInitialClaimPercentage`
   - Remaining: Vests over `legacyNodeVestingDays`
   - Multiple claims possible

3. **Claiming (Non-KYCed)**
   - Single claim after `legacyNodeNonKycedCooldown`
   - Claims full `nodePrice`

## Security Model

### Access Control Layers
1. **Owner**
   - Contract upgrades
   - Emergency functions
   - Configuration changes

2. **Admins**
   - Legacy node minting
   - Snapshotter management
   - No upgrade authority

3. **Users**
   - Node minting (with payment)
   - Node burning
   - Token claiming

### Value Protection
1. **Reentrancy Guards**
   - All value transfers protected
   - State changes before transfers
   - Strict function ordering

2. **Cooldown Periods**
   - Prevent rapid changes
   - Protect against manipulation
   - Different periods for different operations

3. **Pausability**
   - Emergency stop mechanism
   - Protects user funds
   - Controlled by owner

## Dependencies and Inheritance
- `ERC1155Upgradeable`: Base token functionality
- `OwnableUpgradeable`: Access control
- `PausableUpgradeable`: Emergency stops
- `ERC1155SupplyUpgradeable`: Supply tracking
- `UUPSUpgradeable`: Upgrade pattern
- `ReentrancyGuardUpgradeable`: Transaction safety
- `EnumerableSet`: Efficient set operations

## Upgrade Considerations
1. **Storage Layout**
   - Append-only storage pattern
   - No reordering of variables
   - No removal of existing storage

2. **Function Changes**
   - Can add new functions
   - Can modify internal logic
   - Cannot remove public interfaces

3. **Authorization**
   - Only owner can upgrade
   - Must implement `_authorizeUpgrade`
   - Follows UUPS pattern 