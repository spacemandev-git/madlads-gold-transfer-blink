import "dotenv/config";
import { web3, Program } from "@coral-xyz/anchor";
import BN from "bn.js";
const connection = new web3.Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, "confirmed");

const SOULBOUND_PROGRAM_ID = new web3.PublicKey("7DkjPwuKxvz6Viiawtbmb4CqnMKP6eGb1WqYas1airUS");
import { IDL as soulboundIDL } from './legacyIDL/soulBoundAuthority';
import type { SoulBoundAuthority } from "./legacyIDL/soulBoundAuthority";
const soulboundProgram = new Program<SoulBoundAuthority>(soulboundIDL, SOULBOUND_PROGRAM_ID, { connection });

const CARDINAL_REWARD_PROGRAM_ID = new web3.PublicKey("H2yQahQ7eQH8HXXPtJSJn8MURRFEWVesTd8PsracXp1S");
import { IDL as cardinalRewardIDL } from './legacyIDL/cardinalRewardDistributor';
import type { CardinalRewardDistributor } from "./legacyIDL/cardinalRewardDistributor";
const cardinalRewardProgram = new Program<CardinalRewardDistributor>(cardinalRewardIDL, CARDINAL_REWARD_PROGRAM_ID, { connection });

const CARDINAL_STAKE_POOL_ID = new web3.PublicKey("2gvBmibwtBnbkLExmgsijKy6hGXJneou8X6hkyWQvYnF");
import { IDL as cardinalStakeIDL } from './legacyIDL/cardinalStakePool';
import type { CardinalStakePool } from "./legacyIDL/cardinalStakePool";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
const cardinalStakeProgram = new Program<CardinalStakePool>(cardinalStakeIDL, CARDINAL_STAKE_POOL_ID, { connection });

const GOLD_MINT = new web3.PublicKey("5QPAPkBvd2B7RQ6DBGvCxGdAcyWitdvRAP58CdvBiuf7");
const REWARD_DISTRIBUTOR = new web3.PublicKey("6DBnpqRm1szSz25dD1aWEmYzgGoMB59Y1GMv2gtWUSM4");
const STAKE_POOL = new web3.PublicKey("7xmGGtuNNvjKLDwbYWBYGPpAjRqftJnrTyzSRK92yku8");

export async function claimGold(account: string, fromMintAddress: string): Promise<web3.TransactionInstruction> {
    const user = new web3.PublicKey(account);
    const fromMintKey = new web3.PublicKey(fromMintAddress);

    const [sbaUser] = web3.PublicKey.findProgramAddressSync([
        Buffer.from("sba-scoped-user"),
        user.toBuffer(),
    ], soulboundProgram.programId);

    const [scopedSbaUserAuthority] = web3.PublicKey.findProgramAddressSync([
        Buffer.from("sba-scoped-user-nft-program"),
        user.toBuffer(),
        fromMintKey.toBuffer(),
        cardinalRewardProgram.programId.toBuffer(),
    ], soulboundProgram.programId);

    const [stakeEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("stake-entry"),
            STAKE_POOL.toBuffer(),
            fromMintKey.toBuffer(),
            web3.PublicKey.default.toBuffer(),
        ],
        cardinalStakeProgram.programId
    );

    const [rewardEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("reward-entry"),
            REWARD_DISTRIBUTOR.toBuffer(),
            stakeEntry.toBuffer(),
        ],
        cardinalRewardProgram.programId
    );

    const userRewardMintTokenAccount = await getAssociatedTokenAddress(
        GOLD_MINT,
        scopedSbaUserAuthority,
        true
    );

    let { data, keys } = await cardinalRewardProgram.methods
        .claimRewards()
        .accounts({
            rewardEntry,
            rewardDistributor: REWARD_DISTRIBUTOR,
            stakeEntry,
            stakePool: STAKE_POOL,
            originalMint: fromMintKey,
            rewardMint: GOLD_MINT,
            userRewardMintTokenAccount,
            authority: scopedSbaUserAuthority,
            user
        })
        .instruction();

    // Need to set the signer on the PDA to false so that we can serialize
    // the transaction without error. The CPI in the program will flip this
    // back to true before signging with PDA seeds.
    keys = keys.map((k: any) => {
        return {
            ...k,
            isSigner: k.pubkey.equals(scopedSbaUserAuthority) ? false : k.isSigner,
        };
    });

    const nftToken = await getAssociatedTokenAddress(fromMintKey, user);

    const claimIx = await soulboundProgram.methods
        .executeTxScopedUserNftProgram(data)
        .accounts({
            sbaUser,
            nftToken,
            nftMint: fromMintKey,
            authority: user,
            delegate: web3.PublicKey.default,
            authorityOrDelegate: user,
            scopedAuthority: scopedSbaUserAuthority,
            program: cardinalRewardProgram.programId
        })
        .remainingAccounts(keys)
        .preInstructions([
            await cardinalStakeProgram.methods
                .updateTotalStakeSeconds()
                .accounts({
                    stakeEntry,
                    lastStaker: user
                })
                .instruction()
        ])
        .instruction()

    return claimIx;
}

export async function transferGold(account: string, fromMintAddress: string, toMintAddress: String, transferAmount: BN): Promise<web3.TransactionInstruction> {
    const user = new web3.PublicKey(account);
    const fromMintKey = new web3.PublicKey(fromMintAddress);
    const toMintKey = new web3.PublicKey(toMintAddress);

    const [fromSbaUser] = web3.PublicKey.findProgramAddressSync([
        Buffer.from("sba-scoped-user"),
        user.toBuffer(),
    ], soulboundProgram.programId);

    const [fromScopedSbaUserAuthority] = web3.PublicKey.findProgramAddressSync([
        Buffer.from("sba-scoped-user-nft-program"),
        user.toBuffer(),
        fromMintKey.toBuffer(),
        cardinalRewardProgram.programId.toBuffer(),
    ], soulboundProgram.programId);

    const [fromStakeEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("stake-entry"),
            STAKE_POOL.toBuffer(),
            fromMintKey.toBuffer(),
            web3.PublicKey.default.toBuffer(),
        ],
        cardinalStakeProgram.programId
    );

    const [fromRewardEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("reward-entry"),
            REWARD_DISTRIBUTOR.toBuffer(),
            fromStakeEntry.toBuffer(),
        ],
        cardinalRewardProgram.programId
    );

    const fromScopedSbaUserAuthorityAta = await getAssociatedTokenAddress(GOLD_MINT, fromScopedSbaUserAuthority, true)

    const [toScopedSbaUserAuthority] = web3.PublicKey.findProgramAddressSync([
        Buffer.from("sba-scoped-user-nft-program"),
        user.toBuffer(),
        toMintKey.toBuffer(),
        cardinalRewardProgram.programId.toBuffer(),
    ], soulboundProgram.programId);

    const [toStakeEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("stake-entry"),
            STAKE_POOL.toBuffer(),
            toMintKey.toBuffer(),
            web3.PublicKey.default.toBuffer(),
        ],
        cardinalStakeProgram.programId
    );

    const [toRewardEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("reward-entry"),
            REWARD_DISTRIBUTOR.toBuffer(),
            toStakeEntry.toBuffer(),
        ],
        cardinalRewardProgram.programId
    );

    const toScopedSbaUserAuthorityAta = await getAssociatedTokenAddress(GOLD_MINT, toScopedSbaUserAuthority, true)
    const fromNftToken = await getAssociatedTokenAddress(fromMintKey, user);

    let { data, keys } = await cardinalRewardProgram.methods
        .transferRewards(transferAmount)
        .accounts({
            rewardEntryA: fromRewardEntry,
            rewardEntryB: toRewardEntry,
            stakeEntryA: fromStakeEntry,
            stakeEntryB: toStakeEntry,
            rewardDistributor: REWARD_DISTRIBUTOR,
            stakePool: STAKE_POOL,
            originalMintA: fromMintKey,
            originalMintB: toMintKey,
            rewardMint: GOLD_MINT,
            user,
            userRewardMintTokenAccountA: fromScopedSbaUserAuthorityAta,
            userRewardMintTokenAccountB: toScopedSbaUserAuthorityAta,
            authorityA: fromScopedSbaUserAuthority,
            authorityB: toScopedSbaUserAuthority,
        })
        .instruction();

    // Need to set the signer on the PDA to false so that we can serialize
    // the transaction without error. The CPI in the program will flip this
    // back to true before signging with PDA seeds.
    keys = keys.map((k: any) => {
        return {
            ...k,
            isSigner: k.pubkey.equals(fromScopedSbaUserAuthority)
                ? false
                : k.isSigner,
        };
    });

    const transferIx = await soulboundProgram.methods
        .executeTxScopedUserNftProgram(data)
        .accounts({
            sbaUser: fromSbaUser,
            nftToken: fromNftToken,
            nftMint: fromMintKey,
            authority: user,
            delegate: web3.PublicKey.default,
            authorityOrDelegate: user,
            scopedAuthority: fromScopedSbaUserAuthority,
            program: cardinalRewardProgram.programId
        })
        .remainingAccounts(keys)
        .instruction()

    return transferIx;
}

export async function readGold(account: string, fromMintAddress: string): Promise<BN> {
    try {
        const user = new web3.PublicKey(account);
        const fromMintKey = new web3.PublicKey(fromMintAddress);

        const [scopedSbaUserAuthority] = web3.PublicKey.findProgramAddressSync([
            Buffer.from("sba-scoped-user-nft-program"),
            user.toBuffer(),
            fromMintKey.toBuffer(),
            cardinalRewardProgram.programId.toBuffer(),
        ], soulboundProgram.programId);

        const userRewardMintTokenAccount = await getAssociatedTokenAddress(GOLD_MINT, scopedSbaUserAuthority, true);

        const claimAccount = getAccount(connection, userRewardMintTokenAccount);
        return new BN((await claimAccount).amount.toString());
    } catch (e: any) {
        return new BN(0);
    }
}

export async function readUnclaimedGold(fromMintAddress: string): Promise<BN> {
    const fromMintKey = new web3.PublicKey(fromMintAddress);

    const [stakeEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("stake-entry"),
            STAKE_POOL.toBuffer(),
            fromMintKey.toBuffer(),
            web3.PublicKey.default.toBuffer(),
        ],
        cardinalStakeProgram.programId
    );

    const stakeEntryAcc = await cardinalStakeProgram.account.stakeEntry.fetch(stakeEntry);

    const [rewardEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("reward-entry"),
            REWARD_DISTRIBUTOR.toBuffer(),
            stakeEntry.toBuffer(),
        ],
        cardinalRewardProgram.programId
    );

    const rewardEntryAcc = await cardinalRewardProgram.account.rewardEntry.fetch(rewardEntry);

    // This means the staker unstaked (the NFT is not currently staked)
    if (stakeEntryAcc.lastStaker.equals(web3.PublicKey.default)) {
        return new BN(0);
    }


    const totalStakeSeconds = stakeEntryAcc.totalStakeSeconds.add(
        stakeEntryAcc.amount.eq(new BN(0))
            ? new BN(0)
            : new BN(Date.now() / 1000).sub(stakeEntryAcc.lastUpdatedAt ? stakeEntryAcc.lastUpdatedAt : new BN(0))
    );
    const rewardSecondsReceived = rewardEntryAcc.rewardSecondsReceived;
    const rewardDistributorAcc = await cardinalRewardProgram.account.rewardDistributor.fetch(REWARD_DISTRIBUTOR);
    let rewardAmountToReceive = totalStakeSeconds
        .sub(rewardSecondsReceived)
        .div(rewardDistributorAcc.rewardDurationSeconds)
        .mul(rewardDistributorAcc.rewardAmount)
        .mul(new BN(1))
        .div(new BN(10).pow(new BN(rewardDistributorAcc.multiplierDecimals)));

    return rewardAmountToReceive;
}

export async function isStaked(fromMintAddress: string): Promise<boolean> {
    const fromMintKey = new web3.PublicKey(fromMintAddress);

    const [stakeEntry] = web3.PublicKey.findProgramAddressSync(
        [
            Buffer.from("stake-entry"),
            STAKE_POOL.toBuffer(),
            fromMintKey.toBuffer(),
            web3.PublicKey.default.toBuffer(),
        ],
        cardinalStakeProgram.programId
    );

    const stakeEntryAcc = await cardinalStakeProgram.account.stakeEntry.fetch(stakeEntry);

    // This means the staker unstaked (the NFT is not currently staked)
    if (stakeEntryAcc.lastStaker.equals(web3.PublicKey.default)) {
        return false;
    } else {
        return true;
    }
}

/*
//console.log((await readGold("GsvY6rPFaipQ1qsACYFtQu7F9n3JxzBXFw8DDFnMkRpb", "J4fPmhJunArWJq47c7C2TZZdrSbjEbTCUot1ZAhM5MA6")).toString())
//console.log((await readUnclaimedGold("J4fPmhJunArWJq47c7C2TZZdrSbjEbTCUot1ZAhM5MA6")))

const [stakeEntry] = web3.PublicKey.findProgramAddressSync(
    [
        Buffer.from("stake-entry"),
        STAKE_POOL.toBuffer(),
        new web3.PublicKey(fromMintAddress).toBuffer(),
        web3.PublicKey.default.toBuffer(),
    ],
    cardinalStakeProgram.programId
);

const stakeEntryAcc = await cardinalStakeProgram.account.stakeEntry.fetch(stakeEntry);
console.log(JSON.stringify(stakeEntryAcc, null, 2));

console.log((await readGold(account, fromMintAddress)).toString())
console.log((await readUnclaimedGold(fromMintAddress)).toString())

const goldToClaim = await readUnclaimedGold(fromMintAddress);
const ix = await claimGold(account, fromMintAddress);

const goldToTransfer = await readGold(account, fromMintAddress);
const transferIx = await transferGold(account, fromMintAddress, toMintAddress, goldToTransfer);

const msg = new web3.TransactionMessage({
    payerKey: new web3.PublicKey(account),
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [ix]
}).compileToV0Message();
const txn = new web3.VersionedTransaction(msg);
console.log(await connection.simulateTransaction(txn));
*/