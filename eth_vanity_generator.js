'ui';

var config = {
    prefix: "",
    suffix: "",
    threads: 64,
    rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/demo",
    maxRetries: 3
};

var stats = {
    generated: 0,
    checked: 0,
    found: 0,
    running: false,
    startTime: 0
};

var savedWallets = [];
var workers = [];
var logs = [];
var saveTimer = null;
var floatyWindow = null;
var isFloatyShown = false;

console.show();
console.setPosition(0, 0);
console.setSize(1, 0.3);
console.hide();

function log(msg, level) {
    level = level || "info";
    var timestamp = new Date().toLocaleTimeString();
    var logMsg = "[" + timestamp + "] [" + level.toUpperCase() + "] " + msg;
    
    logs.unshift(logMsg);
    if (logs.length > 500) logs.pop();
    
    console.log(logMsg);
    
    ui.post(() => {
        try {
            if (ui.logView) {
                var displayLogs = logs.slice(0, 30);
                ui.logView.setText(displayLogs.join("\n"));
            }
        } catch (e) {
            console.error("Log error: " + e);
        }
    });
}

function logInfo(msg) { log(msg, "info"); }
function logSuccess(msg) { log(msg, "success"); }
function logError(msg) { log(msg, "error"); }

function sha3(data) {
    var buffer = data instanceof ArrayBuffer ? data : (typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return java.security.MessageDigest.getInstance("SHA-256").digest(java.nio.ByteBuffer.wrap(buffer));
}

function bytesToHex(bytes) {
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i] & 0xFF;
        hex.push((b < 16 ? '0' : '') + b.toString(16));
    }
    return hex.join('');
}

function hexToBytes(hex) {
    var bytes = [];
    for (var i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
}

function generatePrivateKey() {
    var random = java.security.SecureRandom.getInstanceStrong();
    var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 32);
    random.nextBytes(bytes);
    return bytesToHex(java.util.Arrays.copyOf(bytes, bytes.length));
}

function privateKeyToPublicKey(privateKey) {
    try {
        var pk = hexToBytes(privateKey);
        var keySpec = new javax.crypto.spec.SecretKeySpec(pk, "EC");
        var keyFactory = java.security.KeyFactory.getInstance("EC");
        var params = java.security.spec.ECGenParameterSpec("secp256k1");
        var gen = java.security.KeyPairGenerator.getInstance("EC");
        gen.initialize(params);
        var ecParams = gen.generateKeyPair().getPublic().getParams();
        var w = org.bouncycastle.math.ec.ECPointUtil.decodePoint(ecParams.getCurve(), java.nio.ByteBuffer.wrap(pk));
        var publicPoint = w.multiply(new org.bouncycastle.math.BigInteger(privateKey, 16));
        return bytesToHex(publicPoint.getEncoded(false)).substring(2);
    } catch (e) {
        var curve = org.bouncycastle.jce.ECNamedCurveTable.getParameterSpec("secp256k1");
        var point = curve.getG().multiply(new java.math.BigInteger(privateKey, 16));
        return bytesToHex(point.getEncoded(false)).substring(2);
    }
}

function publicKeyToAddress(publicKey) {
    var hash = sha3(hexToBytes(publicKey));
    return '0x' + bytesToHex(hash).substring(24);
}

function checkBalance(address) {
    var retries = 0;
    while (retries < config.maxRetries) {
        try {
            var payload = JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_getBalance",
                params: [address, "latest"],
                id: 1
            });
            var response = http.post(config.rpcUrl, payload, {
                "Content-Type": "application/json",
                "connectTimeout": 10000,
                "readTimeout": 10000
            });
            var result = JSON.parse(response.body.string());
            if (result.result) {
                return parseInt(result.result, 16) / 1e18;
            }
            return 0;
        } catch (e) {
            retries++;
            sleep(100);
        }
    }
    return 0;
}

function saveWallet(privateKey, address, balance) {
    var wallet = {
        privateKey: privateKey,
        address: address,
        balance: balance,
        timestamp: new Date().toLocaleString()
    };
    savedWallets.push(wallet);
    scheduleSaveWallets();
    logSuccess("发现钱包! " + address + " = " + balance.toFixed(8) + " ETH");
}

function scheduleSaveWallets() {
    if (saveTimer) return;
    
    saveTimer = threads.start(function() {
        sleep(2000);
        try {
            var content = JSON.stringify(savedWallets, null, 2);
            files.write(files.getSdcardPath() + "/ETH_Wallets.txt", content);
            logInfo("已保存到 " + files.getSdcardPath() + "/ETH_Wallets.txt");
        } catch (e) {
            logError("保存失败: " + e.message);
        }
        saveTimer = null;
    });
}

function saveWalletsNow() {
    try {
        files.write(files.getSdcardPath() + "/ETH_Wallets.txt", JSON.stringify(savedWallets, null, 2));
        return true;
    } catch (e) {
        logError("保存失败: " + e.message);
        return false;
    }
}

function generateAndCheck() {
    while (stats.running) {
        try {
            var privateKey = generatePrivateKey();
            var publicKey = privateKeyToPublicKey(privateKey);
            var address = publicKeyToAddress(publicKey);
            
            threads.atomicAdd(stats.generated, 1);
            
            var matchPrefix = !config.prefix || address.toLowerCase().startsWith("0x" + config.prefix.toLowerCase());
            var matchSuffix = !config.suffix || address.toLowerCase().endsWith(config.suffix.toLowerCase());
            
            if (matchPrefix && matchSuffix) {
                threads.atomicAdd(stats.checked, 1);
                var balance = checkBalance(address);
                if (balance > 0) {
                    threads.atomicAdd(stats.found, 1);
                    saveWallet(privateKey, address, balance);
                }
            }
        } catch (e) {
            logError("错误: " + e.message);
        }
        sleep(1);
    }
}

function startWorkers() {
    if (stats.running) return;
    
    stats.running = true;
    stats.startTime = Date.now();
    stats.generated = 0;
    stats.checked = 0;
    stats.found = 0;
    
    logInfo("开始生成... 前缀:" + (config.prefix || "无") + " 后缀:" + (config.suffix || "无") + " 线程:" + config.threads);
    
    for (var i = 0; i < config.threads; i++) {
        workers.push(threads.start(generateAndCheck));
    }
    
    logSuccess("已启动 " + config.threads + " 线程");
    createFloaty();
    updateUI();
}

function stopWorkers() {
    if (!stats.running) return;
    
    stats.running = false;
    logInfo("正在停止...");
    
    workers.forEach(function(worker) {
        if (worker && worker.isAlive()) {
            worker.join(1000);
        }
    });
    workers = [];
    
    saveWalletsNow();
    logSuccess("已停止. 耗时:" + Math.round((Date.now() - stats.startTime) / 1000) + "秒");
    closeFloaty();
    updateUI();
}

function createFloaty() {
    if (floatyWindow) floatyWindow.close();
    
    floatyWindow = floaty.window(
        <vertical bg="#000000" padding="8">
            <text id="title" text="ETH靓号" textSize="14sp" textColor="#00FF00"/>
            <text id="status" text="运行中" textSize="12sp" textColor="#00FF00"/>
            <text id="stats" text="生成:0 检查:0 发现:0" textSize="11sp" textColor="#FFFFFF"/>
            <text id="wallets" text="钱包:0" textSize="10sp" textColor="#FFD700"/>
        </vertical>
    );
    
    floatyWindow.setPosition(20, 200);
    updateFloatyText();
    isFloatyShown = true;
    
    floatyWindow.on("click", () => {
        engines.all().forEach(e => {
            if (e.getSource() === context) {
                var intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
        });
    });
}

function updateFloatyText() {
    if (!floatyWindow) return;
    try {
        var elapsed = stats.startTime ? Math.round((Date.now() - stats.startTime) / 1000) : 0;
        var timeStr = Math.floor(elapsed / 3600) + ":" + String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0') + ":" + String(elapsed % 60).padStart(2, '0');
        
        floatyWindow.status.setText(stats.running ? "运行中" : "已停止");
        floatyWindow.stats.setText("生成:" + stats.generated + " 检查:" + stats.checked + " 发现:" + stats.found + " " + timeStr);
        floatyWindow.wallets.setText("钱包:" + savedWallets.length);
    } catch (e) {}
}

function closeFloaty() {
    if (floatyWindow) {
        try { floatyWindow.close(); } catch (e) {}
        floatyWindow = null;
        isFloatyShown = false;
    }
}

function updateUI() {
    ui.post(() => {
        try {
            ui.generated.setText("生成:" + stats.generated);
            ui.checked.setText("检查:" + stats.checked);
            ui.found.setText("发现:" + stats.found);
            ui.foundCount.setText("钱包:" + savedWallets.length);
            
            if (stats.running) {
                ui.startBtn.setText("停止");
                ui.prefix.attr("enabled", false);
                ui.suffix.attr("enabled", false);
                ui.threads.attr("enabled", false);
                ui.consoleBtn.setText("隐藏控制台");
                ui.floatyBtn.setText("隐藏悬浮窗");
            } else {
                ui.startBtn.setText("开始");
                ui.prefix.attr("enabled", true);
                ui.suffix.attr("enabled", true);
                ui.threads.attr("enabled", true);
                ui.consoleBtn.setText("控制台");
                ui.floatyBtn.setText("悬浮窗");
            }
            
            var listData = [];
            savedWallets.forEach((w, i) => {
                listData.push((i + 1) + ". " + w.address + " = " + w.balance.toFixed(6) + " ETH");
            });
            ui.walletList.setAdapter(new android.widget.ArrayAdapter(context, android.R.layout.simple_list_item_1, listData));
        } catch (e) {
            console.error("UI错误: " + e);
        }
    });
}

ui.layout(
    <vertical bg="#000000">
        <text text="ETH靓号生成器" textSize="24sp" textColor="#00FF00" gravity="center" margin="10dp"/>
        
        <text text="设置" textSize="16sp" textColor="#888888" margin="10dp,5dp"/>
        
        <horizontal>
            <text text="前缀:" textSize="14sp" textColor="#FFF" w="60dp"/>
            <input id="prefix" hint="1111" textSize="14sp" w="100dp"/>
            <text text="后缀:" textSize="14sp" textColor="#FFF" w="60dp"/>
            <input id="suffix" hint="8888" textSize="14sp" w="100dp"/>
        </horizontal>
        
        <horizontal margin="10dp,5dp">
            <text text="线程:" textSize="14sp" textColor="#FFF" w="60dp"/>
            <input id="threads" text="64" textSize="14sp" w="80dp"/>
        </horizontal>
        
        <horizontal margin="10dp,5dp">
            <text id="generated" text="生成:0" textSize="14sp" textColor="#0F0" w="80dp"/>
            <text id="checked" text="检查:0" textSize="14sp" textColor="#0F0" w="80dp"/>
            <text id="found" text="发现:0" textSize="14sp" textColor="#FF0" w="80dp"/>
            <text id="foundCount" text="钱包:0" textSize="14sp" textColor="#F80" w="80dp"/>
        </horizontal>
        
        <horizontal margin="10dp,5dp">
            <button id="startBtn" text="开始" textSize="18sp" w="100dp" h="50dp"/>
            <button id="consoleBtn" text="控制台" textSize="14sp" w="80dp" h="50dp" margin="5dp"/>
            <button id="floatyBtn" text="悬浮窗" textSize="14sp" w="80dp" h="50dp"/>
        </horizontal>
        
        <text text="日志" textSize="14sp" textColor="#888" margin="10dp,5dp"/>
        <scroll h="150dp">
            <text id="logView" text="准备就绪..." textSize="11sp" textColor="#0F0"/>
        </scroll>
        
        <text text="已保存钱包" textSize="14sp" textColor="#888" margin="10dp,5dp"/>
        <list id="walletList" h="150dp"/>
        
        <text text="保存:/sdcard/ETH_Wallets.txt" textSize="10sp" textColor="#555" gravity="center" margin="5dp"/>
    </vertical>
);

ui.startBtn.on("click", () => {
    if (!stats.running) {
        config.prefix = ui.prefix.text();
        config.suffix = ui.suffix.text();
        config.threads = parseInt(ui.threads.text()) || 64;
        if (config.threads < 1) config.threads = 1;
        if (config.threads > 128) config.threads = 128;
        logs = [];
        startWorkers();
    } else {
        stopWorkers();
    }
});

ui.consoleBtn.on("click", () => {
    if (console.isShowing()) {
        console.hide();
    } else {
        console.show();
    }
});

ui.floatyBtn.on("click", () => {
    if (isFloatyShown) {
        closeFloaty();
    } else {
        createFloaty();
    }
});

ui.walletList.on("item_click", (item, position) => {
    if (savedWallets[position]) {
        var w = savedWallets[position];
        dialogs.confirm("钱包#" + (position + 1), 
            "地址: " + w.address + "\n余额: " + w.balance.toFixed(8) + " ETH\n时间: " + w.timestamp + "\n\n显示私钥?", 
            "显示", "取消"
        ).then(show => {
            if (show) {
                dialogs.alert("警告", "私钥泄露将导致资产被盗!\n\n私钥: " + w.privateKey);
            }
        });
    }
});

if (files.exists(files.getSdcardPath() + "/ETH_Wallets.txt")) {
    try {
        savedWallets = JSON.parse(files.read(files.getSdcardPath() + "/ETH_Wallets.txt"));
        logInfo("已加载 " + savedWallets.length + " 个钱包");
    } catch (e) {
        savedWallets = [];
    }
}

setInterval(() => {
    if (stats.running) {
        updateUI();
        if (isFloatyShown) updateFloatyText();
    }
}, 500);

logInfo("ETH靓号生成器已就绪");

events.on("exit", () => {
    if (stats.running) stopWorkers();
    saveWalletsNow();
    closeFloaty();
});

toast("ETH靓号生成器已启动");