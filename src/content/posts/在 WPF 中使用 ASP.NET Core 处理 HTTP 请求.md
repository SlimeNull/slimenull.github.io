---
title: 在 WPF 中使用 ASP.NET Core 处理 HTTP 请求
published: 2024-10-03T03:50:00+08:00
slug: '202410030950'
description: '直接在 csproj 中添加 Microsoft.AspNetCore.App 的框架引用即可'
image: ''
tags: [ '.NET', 'C#', 'WPF', 'ASP.NET Core', 'Web' ]
category: '.NET'
---

对于 SDK 样式 csproj 的项目, 只需要添加 Microsoft.AspNetCore.App 的框架引用即可直接使用 ASP.NET Core 的所有 API

## 创建项目

首先, 创建一个 SDK 样式 csproj 的 WPF 项目, 并打开项目文件, 它的内容大概是这样:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <UseWPF>true</UseWPF>
  </PropertyGroup>

</Project>
```

然后, 在 `Project` 节点下添加 `ItemGroup` 节点, 并继续向下添加 `FrameworkReference` 节点, 然后设置其 `Include` 特性值为 `Microsoft.AspNetCore.App`. 添加后项目文件大致如下:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <UseWPF>true</UseWPF>
  </PropertyGroup>
  
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

</Project>
```

> 为了调试时方便, 你也可以将 `PropertyGroup` 下的 `OutputType` 设置为 `Exe`, 这样程序在启动的时候就会带有控制台.


## 编写主逻辑

现在, 我们就可以像一个正常的 ASP.NET Core 项目一样, 使用 `WebApplication` 和 `WebApplicationBuilder` 进行后端逻辑的编写了.

接下来, 转到 `App.xaml.cs`, 重写 `OnStartup` 方法, 并添加自己的 Web 初始化和运行逻辑, 最后结果大致如下:

```csharp
/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var builder = WebApplication.CreateBuilder();

        builder.Services.AddControllers();                  // 添加控制器
        builder.WebHost.UseUrls("http://localhost:5000");   // 更改监听地址

        var app = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.MapControllers();

        app.RunAsync();
    }
}
```

接下来, 我们在项目中添加一个 `TestController` 类, 用于测试后端请求处理:

```csharp
[Route("[controller]")]
public class TestController : Controller
{
    [HttpGet]
    public object Get()
    {
        return new
        {
            Fuck = "You world"
        };
    }
}
```

## 最终效果

启动程序, 并在浏览器访问 `http://localhost:5000/test`, 可以看到结果:

![](/images/UseAspNetCoreInWpf_BrowserPreview.png)

关于此主题的更完整示例, 可以在 GitHub 上 [SlimeNull/UseAspNetCoreInWpf](https://github.com/SlimeNull/UseAspNetCoreInWpf) 仓库中查看.

![](/images/Snipaste_2024-10-03_04-01-40.png)