
import fetch from 'node-fetch';

const SECRET_KEY = "sk_dev_BjQKYqyyTrAu55ZHk0bpQVsxGeI56op5eXSaDf1iv0L4MFClxcY1brAaJ2e10CIS";

async function wipe() {
    console.log("🚀 Starting Liveblocks Global Wipe...");

    try {
        // 1. List all rooms
        const listRes = await fetch("https://api.liveblocks.io/v2/rooms", {
            headers: { "Authorization": `Bearer ${SECRET_KEY}` }
        });

        if (!listRes.ok) throw new Error(`Failed to list rooms: ${await listRes.text()}`);
        
        const { data: rooms } = await listRes.json();
        console.log(`Found ${rooms.length} rooms.`);

        if (rooms.length === 0) {
            console.log("✅ No rooms to delete.");
            return;
        }

        // 2. Delete each room
        for (const room of rooms) {
            console.log(`🗑️ Deleting room: ${room.id}...`);
            const delRes = await fetch(`https://api.liveblocks.io/v2/rooms/${room.id}`, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${SECRET_KEY}` }
            });
            
            if (delRes.ok) {
                console.log(`   Successfully deleted ${room.id}`);
            } else {
                console.error(`   Failed to delete ${room.id}: ${await delRes.text()}`);
            }
        }

        console.log("\n✨ Liveblocks backend is now CLEAN.");
        console.log("💡 Remember to clear your browser's IndexedDB (ColorRM_SOTA_V12) and LocalStorage for a 100% fresh start.");

    } catch (error) {
        console.error("❌ Wipe failed:", error.message);
    }
}

wipe();
