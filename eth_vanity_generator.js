'ui';

var config = {
    prefix: "",
    suffix: "",
    threads: 4,
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
            var displayLogs = logs.slice(0, 50);
            ui.logView.setText(displayLogs.join("\n"));
        } catch (e) {
            console.error("Log display error: " + e);
        }
    });
}

function logInfo(msg) {
    log(msg, "info");
}

function logSuccess(msg) {
    log(msg, "success");
}

function logError(msg) {
    log(msg, "error");
}

function logWarning(msg) {
    log(msg, "warning");
}

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
        return privateKeyToPublicKeyImpl(privateKey);
    }
}

function privateKeyToPublicKeyImpl(privateKey) {
    var EC = org.bouncycastle.jce.provider.BouncyCastleProvider.getInstance().getEcMultisetFactory();
    var curve = org.bouncycastle.jce.ECNamedCurveTable.getParameterSpec("secp256k1");
    var domainParams = new org.bouncycastle.jce.spec.ECParameterSpec(
        curve.getCurve(), curve.getG(), curve.getN(), curve.getH()
    );
    var point = curve.getG().multiply(new java.math.BigInteger(privateKey, 16));
    var encoded = point.getEncoded(false);
    return bytesToHex(encoded).substring(2);
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
            if (retries >= config.maxRetries) {
                logError("余额查询失败: " + address);
            }
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
    
    logSuccess("发现有钱包! 地址: " + address + " 余额: " + balance.toFixed(8) + " ETH");
}

function scheduleSaveWallets() {
    if (saveTimer) {
        return;
    }
    
    saveTimer = threads.start(function() {
        sleep(2000);
        
        try {
            var content = JSON.stringify(savedWallets, null, 2);
            var filePath = files.getSdcardPath() + "/ETH_Wallets.txt";
            files.write(filePath, content);
            logInfo("钱包已保存到: " + filePath);
        } catch (e) {
            logError("保存钱包失败: " + e.message);
        }
        
        saveTimer = null;
    });
}

function saveWalletsNow() {
    try {
        var content = JSON.stringify(savedWallets, null, 2);
        var filePath = files.getSdcardPath() + "/ETH_Wallets.txt";
        files.write(filePath, content);
        return true;
    } catch (e) {
        logError("立即保存失败: " + e.message);
        return false;
    }
}

function generateAndCheck() {
    var threadId = threads.currentThread().getId();
    logInfo("线程 " + threadId + " 已启动");
    
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
            logError("生成钱包出错: " + e.message);
        }
        
        sleep(1);
    }
    
    logInfo("线程 " + threadId + " 已停止");
}

function startWorkers() {
    if (stats.running) {
        return;
    }
    
    stats.running = true;
    stats.startTime = Date.now();
    stats.generated = 0;
    stats.checked = 0;
    stats.found = 0;
    
    logInfo("开始生成靓号钱包...");
    logInfo("前缀: " + (config.prefix || "无"));
    logInfo("后缀: " + (config.suffix || "无"));
    logInfo("线程数: " + config.threads);
    
    for (var i = 0; i < config.threads; i++) {
        workers.push(threads.start(generateAndCheck));
    }
    
    logSuccess("已启动 " + config.threads + " 个工作线程");
    updateUI();
}

function stopWorkers() {
    if (!stats.running) {
        return;
    }
    
    stats.running = false;
    
    logInfo("正在停止所有线程...");
    
    workers.forEach(function(worker) {
        if (worker && worker.isAlive()) {
            worker.join(1000);
        }
    });
    workers = [];
    
    saveWalletsNow();
    
    var elapsed = Math.round((Date.now() - stats.startTime) / 1000);
    logSuccess("已停止. 总耗时: " + elapsed + "秒");
    updateUI();
}

function updateUI() {
    ui.post(() => {
        try {
            var elapsed = stats.startTime ? Math.round((Date.now() - stats.startTime) / 1000) : 0;
            var hours = Math.floor(elapsed / 3600);
            var minutes = Math.floor((elapsed % 3600) / 60);
            var seconds = elapsed % 60;
            var timeStr = String(hours).padStart(2, '0') + ":" + 
                          String(minutes).padStart(2, '0') + ":" + 
                          String(seconds).padStart(2, '0');
            
            ui.generated.setText("已生成: " + stats.generated);
            ui.checked.setText("已检查: " + stats.checked);
            ui.found.setText("已发现: " + stats.found);
            ui.elapsed.setText("耗时: " + timeStr);
            ui.foundCount.setText("发现钱包: " + savedWallets.length);
            
            if (stats.running) {
                ui.startBtn.setText("停止");
                ui.prefix.attr("enabled", false);
                ui.suffix.attr("enabled", false);
                ui.threads.attr("enabled", false);
                ui.consoleBtn.setText("隐藏控制台");
            } else {
                ui.startBtn.setText("开始");
                ui.prefix.attr("enabled", true);
                ui.suffix.attr("enabled", true);
                ui.threads.attr("enabled", true);
                ui.consoleBtn.setText("显示控制台");
            }
            
            var listData = [];
            savedWallets.forEach((w, i) => {
                listData.push((i + 1) + ". " + w.address.substring(0, 10) + "..." + 
                             w.address.substring(38) + " | " + w.balance.toFixed(6) + " ETH");
            });
            
            var adapter = new android.widget.ArrayAdapter(context, android.R.layout.simple_list_item_1, listData);
            ui.walletList.setAdapter(adapter);
        } catch (e) {
            console.error("UI update error: " + e);
        }
    });
}

ui.layout(
    <vertical bg="#000000" padding="0">
        <scroll h="*">
            <vertical padding="16">
                <text text="ETH靓号生成器" textSize="28sp" textColor="#00FF00" gravity="center" marginBottom="16" typeface="monospace"/>
                
                <card bg="#1a1a1a" padding="12" marginBottom="12">
                    <vertical>
                        <text text="靓号规则设置" textSize="16sp" textColor="#888888" marginBottom="8"/>
                        
                        <horizontal marginBottom="8">
                            <text text="前缀: " textSize="14sp" textColor="#FFFFFF" w="70dp"/>
                            <input id="prefix" hint="如: 1111" textSize="14sp" textColor="#FFFFFF" bg="#333333" w="150dp"/>
                        </horizontal>
                        
                        <horizontal marginBottom="8">
                            <text text="后缀: " textSize="14sp" textColor="#FFFFFF" w="70dp"/>
                            <input id="suffix" hint="如: 8888" textSize="14sp" textColor="#FFFFFF" bg="#333333" w="150dp"/>
                        </horizontal>
                        
                        <horizontal>
                            <text text="线程: " textSize="14sp" textColor="#FFFFFF" w="70dp"/>
                            <input id="threads" text="64" textSize="14sp" textColor="#FFFFFF" bg="#333333" w="80dp"/>
                        </horizontal>
                    </vertical>
                </card>
                
                <card bg="#1a1a1a" padding="12" marginBottom="12">
                    <vertical>
                        <horizontal gravity="center">
                            <text id="generated" text="已生成: 0" textSize="14sp" textColor="#00FF00" marginRight="15"/>
                            <text id="checked" text="已检查: 0" textSize="14sp" textColor="#00FF00" marginRight="15"/>
                            <text id="found" text="已发现: 0" textSize="14sp" textColor="#FFD700"/>
                        </horizontal>
                        <horizontal gravity="center" marginTop="5">
                            <text id="elapsed" text="耗时: 00:00:00" textSize="12sp" textColor="#888888" marginRight="15"/>
                            <text id="foundCount" text="发现钱包: 0" textSize="12sp" textColor="#888888"/>
                        </horizontal>
                    </vertical>
                </card>
                
                <horizontal marginBottom="12">
                    <button id="startBtn" text="开始" textSize="18sp" textColor="#FFFFFF" bg="#00AA00" w="0" h="50dp" marginRight="10"/>
                    <button id="consoleBtn" text="显示控制台" textSize="14sp" textColor="#FFFFFF" bg="#FF6600" w="0" h="50dp"/>
                </horizontal>
                
                <card bg="#1a1a1a" padding="8" marginBottom="12">
                    <vertical>
                        <text text="运行日志" textSize="14sp" textColor="#888888" marginBottom="5"/>
                        <scroll h="200dp">
                            <text id="logView" text="" textSize="11sp" textColor="#00FF00" typeface="monospace"/>
                        </scroll>
                    </vertical>
                </card>
                
                <card bg="#1a1a1a" padding="12">
                    <vertical>
                        <text text="已保存的钱包 (点击查看私钥)" textSize="14sp" textColor="#888888" marginBottom="8"/>
                        <list id="walletList" h="250dp"/>
                    </vertical>
                </card>
                
                <text text="钱包保存在: /sdcard/ETH_Wallets.txt" textSize="11sp" textColor="#555555" gravity="center" marginTop="12"/>
            </vertical>
        </scroll>
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
        ui.consoleBtn.setText("显示控制台");
    } else {
        console.show();
        ui.consoleBtn.setText("隐藏控制台");
    }
});

ui.walletList.on("item_click", (item, position) => {
    if (savedWallets[position]) {
        var wallet = savedWallets[position];
        dialogs.confirm("钱包信息", 
            "地址: " + wallet.address + "\n\n" +
            "余额: " + wallet.balance.toFixed(8) + " ETH\n\n" +
            "时间: " + wallet.timestamp + "\n\n" +
            "是否显示私钥?", 
            "显示", "取消"
        ).then(show => {
            if (show) {
                dialogs.confirm("警告", "私钥一旦泄露将导致资产被盗！\n\n私钥: " + wallet.privateKey, "确认", "取消");
            }
        });
    }
});

if (files.exists(files.getSdcardPath() + "/ETH_Wallets.txt")) {
    try {
        var content = files.read(files.getSdcardPath() + "/ETH_Wallets.txt");
        savedWallets = JSON.parse(content);
        logInfo("已加载 " + savedWallets.length + " 个钱包");
        updateUI();
    } catch (e) {
        logError("加载钱包失败: " + e.message);
        savedWallets = [];
    }
} else {
    logInfo("未找到已保存的钱包，将创建新文件");
}

setInterval(() => {
    if (stats.running) {
        updateUI();
    }
}, 500);

logInfo("ETH靓号生成器已就绪");
logInfo("建议: 前缀设置2-4位数字更容易找到");

events.on("exit", () => {
    if (stats.running) {
        stopWorkers();
    }
    saveWalletsNow();
});