import { Hono } from "hono";
import { cors } from 'hono/cors';
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ActionError, ActionGetResponse, ActionPostResponse } from "@solana/actions";
import "dotenv/config";
import { web3 } from "@coral-xyz/anchor";
import * as madlib from './madlib';
import { Helius } from 'helius-sdk';
import { BN } from "bn.js";

const connection = new web3.Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, "confirmed");
const helius = new Helius(process.env.HELIUS_API_KEY as string);

const app = new Hono();
const url = "https://goldlads.blinkgames.dev"
app.use('/public/*', serveStatic({ root: "./" }));
app.use('*', cors({
    origin: ['*'], //TODO: Restrict to x.com or twitter.com
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', "Accept-Encoding"],
    exposeHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400,
}));

app.get("/", async (c) => c.redirect("https://spacemandev.notion.site/Mad-Lads-Gold-Transfer-Blink-85d9c545b10c41ad955d90a2287ff96e?pvs=4"));

app.get("/blink", async (c) => {
    const response: ActionGetResponse = {
        icon: `${url}/public/gold.png`,
        title: "Mad Lads Gold Transfer",
        description: `
Transfer gold between two madlads.
Simply put the TOKEN_ADDRESS_FROM,TOKEN_ADDRESS_TO with the ',' between them and we'll take care of the rest.
BE CAREFUL, WHILE I DO NOT INTEND TO STEAL YOUR LADS, SOMEONE ELSE COULD POST THIS AND SCAM YOU.`,
        label: "Transfer",
        links: {
            actions: [
                {
                    href: `/transfer?nfts={addresses}`,
                    label: "Transfer",
                    parameters: [
                        {
                            name: "addresses",
                            label: "from_address,to_address"
                        },
                    ],
                }
            ]
        }
    };
    return c.json(response, 200);
})

app.post("/transfer", async (c) => {
    try {
        const { account } = await c.req.json();
        const nfts = c.req.query("nfts");
        console.log(nfts);
        // Check that both NFTs are MAD LADS & owned by the SAME WALLET & UNSTAKED
        const [fromMintAddress, toMintAddress] = nfts!.split(",");

        const MADLADS_AUTHORITY = "2RtGg6fsFiiF1EQzHqbd66AhW7R5bWeQGpTbv2UMkCdW";
        const fromAsset = await helius.rpc.getAsset({ id: fromMintAddress });
        const toAsset = await helius.rpc.getAsset({ id: toMintAddress });
        if (
            fromAsset.authorities![0].address != MADLADS_AUTHORITY ||
            toAsset.authorities![0].address != MADLADS_AUTHORITY
        ) {
            throw new Error("One of the assets doesn't seem to be a mad lad!")
        }

        if (fromAsset.ownership.owner != account || toAsset.ownership.owner != account) {
            throw new Error("Must own both mad lads!")
        }

        if (!(await madlib.isStaked(fromMintAddress)) || !(await madlib.isStaked(toMintAddress))) {
            throw new Error("Mad Lads must be staked to transfer gold!")
        }

        const goldToTransfer = await madlib.readGold(account, fromMintAddress);
        if (goldToTransfer.eq(new BN(0))) {
            throw new Error("From Mint doesn't have any claimed gold. Try unstaking and restaking to claim the pending gold.")
        }


        const claimIx = await madlib.claimGold(account, fromMintAddress);
        const transferIx = await madlib.transferGold(account, fromMintAddress, toMintAddress, goldToTransfer);
        const msg = new web3.TransactionMessage({
            payerKey: new web3.PublicKey(account),
            recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
            instructions: [claimIx, transferIx]
        }).compileToV0Message();
        const txn = new web3.VersionedTransaction(msg);
        const response: ActionPostResponse = {
            transaction: Buffer.from(txn.serialize()).toString("base64"),
            message: `Transfering ${goldToTransfer} gold from ${fromAsset.content?.metadata.name} to ${toAsset.content?.metadata.name}`
        }
        return c.json(response, 200);
    } catch (e: any) {
        const error: ActionError = { message: e.message }
        return c.json(error, 400);
    }
})


serve({
    fetch: app.fetch,
    port: Number(process.env.PORT) || 3000
})
console.log(`Hono running on port ${process.env.PORT || 3000}`);