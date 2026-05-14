'ui';

var stats = {
    generated: 0,
    checked: 0,
    found: 0,
    running: false
};

var savedWallets = [];

console.show();
console.hide();

ui.layout(
    <vertical bg="#000000">
        <text text="ETH靓号生成器" textSize="20sp" textColor="#00FF00" gravity="center"/>
        
        <text text="前缀:" textSize="14sp" textColor="#FFF"/>
        <input id="prefix" text="" hint="1111"/>
        
        <text text="后缀:" textSize="14sp" textColor="#FFF"/>
        <input id="suffix" text="" hint="8888"/>
        
        <text text="线程:" textSize="14sp" textColor="#FFF"/>
        <input id="threads" text="64"/>
        
        <button id="startBtn" text="开始"/>
        <button id="stopBtn" text="停止" enabled="false"/>
        
        <text id="status" text="状态: 等待" textSize="14sp" textColor="#FFF"/>
        
        <text id="log" text="日志..." textSize="12sp" textColor="#0F0"/>
        
        <text text="钱包列表:" textSize="14sp" textColor="#FFF"/>
        <list id="walletList"/>
    </vertical>
);

ui.startBtn.on("click", () => {
    stats.running = true;
    ui.startBtn.attr("enabled", false);
    ui.stopBtn.attr("enabled", true);
    ui.status.setText("状态: 运行中");
    ui.log.setText("开始生成...");
    
    var thread = threads.start(function() {
        var prefix = ui.prefix.text();
        var suffix = ui.suffix.text();
        var numThreads = parseInt(ui.threads.text()) || 64;
        
        ui.log.setText("前缀:" + prefix + " 后缀:" + suffix + " 线程:" + numThreads);
    });
});

ui.stopBtn.on("click", () => {
    stats.running = false;
    ui.startBtn.attr("enabled", true);
    ui.stopBtn.attr("enabled", false);
    ui.status.setText("状态: 已停止");
    ui.log.setText("已停止");
});

toast("ETH靓号生成器已启动");