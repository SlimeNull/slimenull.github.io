# 嗨! 这里是 Null 的博客!

<link rel="stylesheet" href="style/style.css"/>

<div id="blogs">
    <hr/>
    <div>
        <a href="/blog/113813184">
            <h2>
                [.NET] WPF XAML 原理, 节点与实例, 以及一些重要的零碎知识点
            </h2>
            <p>
                当你查资料时, 看到那些眼花缭乱的 xaml 代码, 让人瞬间没有了学习的欲望… 先试着寻找下其中的规律吧.节点与实例:首先看看上面的文章, 从我们最常接触的 Button 入手吧. Button 是可以用 CS 代码来进行实例化, 然后放置在窗口中的, 而其它的元素, 例如根节点 Window, 都是可以通过 CS 代码进行实例化.可以推测出, 在 xaml 中, 一个个的节点, 例如 Button, Label, 其实就是等同于声明一个对应类型的实例.那么如何在 CS 代码中访问这个实例呢?
            </p>
        </a>
    </div>
    <div>
        <a href="/blog/113765554">
            <h2>
                [C#] MCI 详解与封装类, MCI 播放音乐, 获取播放状态, 获取音频长度, 进度调整,
            </h2>
            <p>
                淦!琢磨了一晚上啊, 总算有些眉目了.首先, MCI的全称是Multimedia Control Interface, 即多媒体控制接口, 通过它, 我们可以做到播放音频视频, 甚至录制音频, 虽然古老, 但是真的强大.注意, 文章较官方文档有不少删减, 如果看标准内容, 还是看官方文档比较好.MCI Command Strings 官方文档: Microsoft Command Strings - Win32 app | Microsoft Docs哦对了, 文档是纯英文哦~理论基础:
            </p>
        </a>
    </div>
    <div>
        <a href="/blog/109348146">
            <h2>
                [C#] CHO.Json操作Json数据
            </h2>
            <p>
                这是一个类似于Newtonsoft.Json的项目, 但与其有些出入。这是它与Newtonsoft.Json的差别:CHO.Json支持你像Python那样不需要实体类而简便的操作小型数据, 也支持将类的实例序列化为Json文本与将分析完毕的Json数据反序列化为特定类的实例CHO.Json少了许多冗余的功能, 例如将图片序列化为字符串, 因此CHO.Json可能要比Newtonsoft.Json轻量许多。CHO.Json的源代码比Newtonsoft.Json更适合初学者阅读, 在看懂它的代.
            </p>
        </a>
    </div>
    <div>
        <a href="/blog/113793031">
            <h2>
                [C#] 就让这张图片来揭露你的本性吧! 老绅士.
            </h2>
            <p>
                淦!看到上面那幅图了吗? 放大, 放大, 看到了吗? 说的就是你 (滑稽
            </p>
        </a>
    </div>
    <div>
        <a href="/blog/113856427">
            <h2>
                [C#] 绘制函数图像! 可拖动, 可缩放, 可调整精度
            </h2>
            <p>
                欸嘿, 这就是程序图了, 通过鼠标拖拽可以移动, 鼠标滚轮可以缩放, 右下角还可以选择要绘制的函数. 项目仓库链接在文章末尾基本原理:Graphics 绘图, 不用我说了吧? 如果你不是很懂, 留言, 我会专门写一篇文章来介绍 Graphics.带入求值, 没啥难的. 线是一个个点连起来的, 也就是:然后, 标尺, 也是一个个线呗, 那个数字的话, 就是这个:填充小三角的话, 就是这个:关于优化:首先是计算问题, 保证仅仅计算需要显示的区域, 区域外的坐标不予以计算, 以节省资源.然.
            </p>
        </a>
    </div>
</div>

<script>
    function CreateBlogLinkBlock(title, description, url){
        let wholeBlockElement = document.createElement("div");
        let linkElement = document.createElement("a");
        let titleElement = document.createElement("h2");
        let descElement = document.createElement("div");
        linkElement.setAttribute("href", url);
        titleElement.innerText = title;
        descElement.innerText = description;

        linkElement.appendChild(titleElement);
        linkElement.appendChild(descElement);
        wholeBlockElement.appendChild(linkElement);
        
        return wholeBlockElement;
    }
    var blogReq = new XMLHttpRequest();
    if (blogReq) {
        blogReq.onload = function(e) {
            
        }
        blogReq.open("get", "/blogs/info.json", true)
    }
</script>

