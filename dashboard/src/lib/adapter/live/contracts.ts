// viem public client + minimal ABIs for the reads that are wireable today against the
// deployed eERC stack (Registrar, TestUSDC). MM-contract ABIs (AuctionHouse, MONIAOracle,
// LoanBook, Vault, MemberRegistry) get added here once those contracts are deployed —
// their signatures are specified in Readme.md §9.
import { createPublicClient, http, type Address } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { CHAIN_ID, RPC_FUJI, RPC_LOCAL, ADDRESSES } from '../../../config';

export function publicClient() {
  // Fuji by default; local Anvil (31337) if configured.
  const chain = avalancheFuji;
  const url = CHAIN_ID === 43113 ? RPC_FUJI : RPC_LOCAL;
  return createPublicClient({ chain, transport: http(url) });
}

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export const registrarAbi = [
  { type: 'function', name: 'isUserRegistered', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getUserPublicKey', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256[2]' }] },
] as const;

export async function readRegistered(user: Address): Promise<boolean> {
  if (!ADDRESSES.registrar) throw new Error('Registrar not deployed');
  return publicClient().readContract({ address: ADDRESSES.registrar as Address, abi: registrarAbi, functionName: 'isUserRegistered', args: [user] });
}

export async function readUsdcBalance(user: Address): Promise<bigint> {
  if (!ADDRESSES.testUsdc) throw new Error('TestUSDC not deployed');
  return publicClient().readContract({ address: ADDRESSES.testUsdc as Address, abi: erc20Abi, functionName: 'balanceOf', args: [user] });
}
