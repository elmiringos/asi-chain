import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { Account, Transaction, Network, WalletState } from 'types/wallet';
import { RChainService } from 'services/rchain';
import { SecureStorage } from 'services/secureStorage';
import TransactionHistoryService from 'services/transactionHistory';

const initialNetworks: Network[] = [
  {
    id: 'custom',
    name: 'Custom Network',
    url: 'http://localhost:40403',
    readOnlyUrl: 'http://localhost:40453',
    shardId: 'root',
  },
  {
    id: 'mainnet',
    name: 'Firefly Mainnet',
    url: process.env.REACT_APP_FIREFLY_MAINNET_URL || 'https://146.235.215.215:443',
    readOnlyUrl: process.env.REACT_APP_FIREFLY_MAINNET_READONLY_URL || 'https://146.235.215.215:443',
    shardId: '',
  },
  {
    id: 'testnet',
    name: 'Firefly Testnet',
    url: process.env.REACT_APP_FIREFLY_TESTNET_URL || 'https://testnet6.rchain.coop:443',
    readOnlyUrl: process.env.REACT_APP_FIREFLY_TESTNET_READONLY_URL || 'https://testnet6.rchain.coop:443',
    shardId: 'testnet6',
  },
  {
    id: 'local',
    name: 'Local Network',
    url: process.env.REACT_APP_FIREFLY_LOCAL_URL || 'http://localhost:40403',
    readOnlyUrl: process.env.REACT_APP_FIREFLY_LOCAL_READONLY_URL || 'http://localhost:40453',
    adminUrl: process.env.REACT_APP_FIREFLY_LOCAL_ADMIN_URL || 'http://localhost:40405',
    shardId: 'root',
  },
];

// Load accounts from secure storage (without private keys)
const loadAccountsFromSecureStorage = (): Account[] => {
  const secureAccounts = SecureStorage.getEncryptedAccounts();
  return secureAccounts.map(acc => ({
    ...acc,
    privateKey: undefined,
  } as Account));
};

const initialState: WalletState = {
  accounts: loadAccountsFromSecureStorage(),
  selectedAccount: null,
  transactions: [],
  networks: initialNetworks,
  selectedNetwork: initialNetworks.find(n => n.id === 'custom') || initialNetworks[0], // Default to custom network
  isLoading: false,
  error: null,
};

export const fetchBalance = createAsyncThunk(
  'wallet/fetchBalance',
  async ({ account, network }: { account: Account; network: Network }) => {
    const rchain = new RChainService(network.url, network.readOnlyUrl, network.adminUrl, network.shardId);
    const atomicBalance = await rchain.getBalance(account.revAddress);
    
    // Convert from atomic units to REV (divide by 100000000)
    const balance = (parseInt(atomicBalance) / 100000000).toString();
    
    return { accountId: account.id, balance };
  }
);

export const sendTransaction = createAsyncThunk(
  'wallet/sendTransaction',
  async ({
    from,
    to,
    amount,
    password,
    network,
  }: {
    from: Account;
    to: string;
    amount: string;
    password?: string;
    network: Network;
  }) => {
    // Get private key from unlocked account or decrypt with password
    let privateKey: string | undefined;
    
    // First try to get from session
    const unlockedAccount = SecureStorage.getUnlockedAccount(from.id);
    if (unlockedAccount?.privateKey) {
      privateKey = unlockedAccount.privateKey;
    } else if (password) {
      // Try to unlock with password
      const unlocked = SecureStorage.unlockAccount(from.id, password);
      if (unlocked?.privateKey) {
        privateKey = unlocked.privateKey;
      }
    }
    
    if (!privateKey) {
      throw new Error('Account is locked. Please provide password or unlock account first.');
    }
    
    const rchain = new RChainService(network.url, network.readOnlyUrl, network.adminUrl, network.shardId);
    
    // Convert amount to atomic units (REV has 8 decimal places)
    const atomicAmount = Math.floor(parseFloat(amount) * 100000000).toString();
    
    const deployId = await rchain.transfer(from.revAddress, to, atomicAmount, privateKey);
    
    const transaction: Transaction = {
      id: deployId,
      deployId,
      from: from.revAddress,
      to,
      amount,
      timestamp: new Date(),
      status: 'pending',
    };
    
    // Add to transaction history
    const historyTx = TransactionHistoryService.addTransaction({
      timestamp: new Date(),
      type: 'send',
      from: from.revAddress,
      to,
      amount: atomicAmount, // Store atomic amount
      deployId,
      status: 'pending',
      network: network.name
    });
    
    // Try to wait for confirmation (non-blocking)
    rchain.waitForDeployResult(deployId, 10).then(result => {
      if (result.status === 'completed') {
        TransactionHistoryService.updateTransaction(historyTx.id, {
          status: 'confirmed',
          blockHash: result.blockHash,
          gasCost: result.cost?.toString()
        });
      } else if (result.status === 'errored' || result.status === 'system_error') {
        TransactionHistoryService.updateTransaction(historyTx.id, {
          status: 'failed'
        });
      }
    }).catch(error => {
      console.log('Could not get deploy result for transaction history:', error);
    });
    
    return transaction;
  }
);

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    // Sync accounts from auth state
    syncAccounts: (state, action: PayloadAction<Account[]>) => {
      state.accounts = action.payload.map(acc => ({
        ...acc,
        privateKey: undefined, // Never store private keys in wallet state
      }));
      
      // Update selected account if it exists in new accounts
      if (state.selectedAccount) {
        const updated = state.accounts.find(a => a.id === state.selectedAccount!.id);
        if (updated) {
          state.selectedAccount = updated;
        } else {
          state.selectedAccount = state.accounts[0] || null;
        }
      } else if (state.accounts.length > 0) {
        state.selectedAccount = state.accounts[0];
      }
    },
    selectAccount: (state, action: PayloadAction<string>) => {
      const account = state.accounts.find(a => a.id === action.payload);
      if (account) {
        state.selectedAccount = account;
      }
    },
    selectNetwork: (state, action: PayloadAction<string>) => {
      const network = state.networks.find(n => n.id === action.payload);
      if (network) {
        state.selectedNetwork = network;
      }
    },
    removeAccount: (state, action: PayloadAction<string>) => {
      // Remove from secure storage
      SecureStorage.removeAccount(action.payload);
      
      // Update state
      state.accounts = state.accounts.filter(a => a.id !== action.payload);
      if (state.selectedAccount?.id === action.payload) {
        state.selectedAccount = state.accounts[0] || null;
      }
    },
    updateAccountBalance: (state, action: PayloadAction<{ accountId: string; balance: string }>) => {
      const account = state.accounts.find(a => a.id === action.payload.accountId);
      if (account) {
        account.balance = action.payload.balance;
      }
      if (state.selectedAccount?.id === action.payload.accountId) {
        state.selectedAccount.balance = action.payload.balance;
      }
    },
    addTransaction: (state, action: PayloadAction<Transaction>) => {
      state.transactions.unshift(action.payload);
    },
    clearError: (state) => {
      state.error = null;
    },
    updateNetwork: (state, action: PayloadAction<Network>) => {
      const index = state.networks.findIndex(n => n.id === action.payload.id);
      if (index !== -1) {
        state.networks[index] = action.payload;
        // Update selected network if it's the one being edited
        if (state.selectedNetwork.id === action.payload.id) {
          state.selectedNetwork = action.payload;
        }
      } else {
        // Add new custom network
        state.networks.push(action.payload);
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBalance.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchBalance.fulfilled, (state, action) => {
        const account = state.accounts.find(a => a.id === action.payload.accountId);
        if (account) {
          const previousBalance = account.balance || '0';
          const newBalance = action.payload.balance;
          
          // Update balance
          account.balance = newBalance;
        }
        if (state.selectedAccount?.id === action.payload.accountId) {
          state.selectedAccount.balance = action.payload.balance;
        }
        state.isLoading = false;
      })
      .addCase(fetchBalance.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to fetch balance';
        state.isLoading = false;
      })
      .addCase(sendTransaction.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(sendTransaction.fulfilled, (state, action) => {
        state.transactions.unshift(action.payload);
        state.isLoading = false;
      })
      .addCase(sendTransaction.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to send transaction';
        state.isLoading = false;
      });
  },
});

export const {
  syncAccounts,
  selectAccount,
  selectNetwork,
  removeAccount,
  updateAccountBalance,
  addTransaction,
  clearError,
  updateNetwork,
} = walletSlice.actions;

export default walletSlice.reducer;