---
title: '如何优雅的在一个解决方案内使 C# 项目引用 C++ 库项目'
published: 2024-10-06T06:03:00+08:00
slug: '202410060603'
description: '指定 ProjectReference 的 ReferenceOutputAssembly 为 false, 并使用自定义 Target, 并添加 Copy 项以自动拷贝库构建输出'
image: ''
tags: [".NET", "CSharp", "C++", "Visual Studio", "MSBuild", "库"]
category: '.NET'
draft: false 
lang: ''
---

如果在一个解决方案内, 有一个 C# 项目, 需要使用另一个 C++ 库项目构建出的 dll...

本文章示例代码已上传至 GitHub 仓库: [SlimeNull/CSharpUseCppLibraryProject](https://github.com/SlimeNull/CSharpUseCppLibraryProject)

> 注意, 此文章中需要使用的 C# 项目, 最好是 SDK 样式 csproj, 参考: 
> - [.NET 升级助手概述 - .NET Core | Microsoft Learn](https://learn.microsoft.com/zh-cn/dotnet/core/porting/upgrade-assistant-overview)
> - [如何在 VS 中创建 SDK 样式的 .NET Framework 项目](https://stackoverflow.com/questions/63055430/how-to-create-an-sdk-style-net-framework-project-in-vs)

## 不太方便的常见手动方案

常见的手动方案有以下几种:

1. 手动构建 C++ 项目, 并将其复制到 C# 项目内, 然后指定自动拷贝
2. 手动构建 C++ 项目, 并将其复制到 C# 项目的构建输出目录, 以使 C# 项目在运行时不出问题

第一种方案会导致二进制文件直接被包含到项目中, 这意味着, 如果你的仓库使用了版本控制, 那么每一次该二进制文件变更,
都会在版本控制中留下历史记录. 而且考虑到二进制文件的大小, 这也会使仓库的空间占用大大增加.

第二种方案不会污染版本控制, 但是如果一个人刚接触此项目, 他可能并不知道需要将 C++ 库项目的构建输出复制到 C# 项目的构建输出,
然后在 C# 项目运行崩溃时感到疑惑.

当然, 第二种方案你也可以在项目中留下 readme, 并在其写明构建流程, 但这无疑是使构建流程更加复杂了.


## 行不通的预构建与构建后事件

我们知道, 使用 Visual Studio 构建项目, 可以指定 "预构建事件" 和 "构建后事件",
或许我们可以通过在其中写指令, 指定在构建 C# 项目前, 先构建 C++ 项目, 在构建后再将 C++ 项目的构建输出自动拷贝到 C# 项目构建输出目录

假如我们使用 MSBuild 直接构建 vcproj

```cmd
MSBuild TestDll.vcproj
```

> 要使用 MSBuild 指令, 你需要在开始菜单中, 打开 "VS 2022 开发者命令行", 或者手动配置 PATH 环境变量.

你会发现, 构建输出并不在解决方案下的 "x64/Debug" 目录下, 而是在项目文件夹下的 "Debug" 目录下.
这和 Visual Studio 的构建行为不一致.

而且, 如果你真的在预构建事件中执行 MSBuild 指令, 你会发现, 它根本找不到这个指令, 这说明在构建时, PATH 环境变量中找不到 MSBuild 这个可执行文件.

![MSBuild 找不到](/images/MSBuild_not_found.png)

再考虑到构建者的 MSBuild 位置是不确定的, 所以, 在预构建与构建后事件中使用 MSBuild 的这条路堵死了.

## 项目引用自定义目标

如果你曾阅读过 csproj, 那么你肯定知道, C# 项目的项目引用, 是通过 ItemGroup 下的 ProjectReference 实现的.
其实, 我们也可以通过 ProjectReference 来引用 C++ 项目.

右键项目, 添加项目引用, 并勾选 C++ 项目然后确认, 或者直接修改 csproj, 添加 ProjectReference 之后,
你会在 C# 项目中的 "依赖项" 下看到一个警告.

![C# 项目引用 C++ 项目的警告](/images/WarningWhenCSharpReferenceCppProject.png)

这是因为 C# 不存在 "引用" C++ 程序集的说法, 打开 csproj, 并在对应 ProjectReference 下添加 `ReferenceOutputAssembly="False"` 即可消除此警告.

```xml
<ProjectReference Include="..\TestDll\TestDll.vcxproj" ReferenceOutputAssembly="False" />
```

现在, 当构建 C# 项目的时候, 指定的 C++ 项目 TestDll 就会被自动构建. 不过我们还需要添加自定义 "Target" 以自动拷贝 C++ 项目的构建输出到 C# 项目输出目录.

打开项目 csproj, 并在 `Project` 节点下添加以下代码:

```xml
<ItemGroup>
  <DllFiles Include="../x64/$(Configuration)/*.dll;../x64/$(Configuration)/*.pdb" />
</ItemGroup>

<Target Name="CopyDLL" AfterTargets="Build">
  <Copy SourceFiles="@(DllFiles)" DestinationFolder="$(OutDir)" />
</Target>
```

其中:

- ItemGroup 下的 DllFiles 表示 C++ 项目下输出的 dll 和 pdb 文件,
  这里 DllFiles 名称可以换成其他任意自定义名称, `$(Configuration)` 则表示当前构建配置
- 下面的 Target 则是实际进行拷贝的目标了, `AfterTargets="Build"` 表示它在构建之后执行.
  SourceFiles 这里直接引用前面定义的 DllFiles, DestinationFolder 则是当前项目的构建输出目录, 使用 $(OutDir) 进行引用

完整供参考的 csproj 如下:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\TestDll\TestDll.vcxproj" ReferenceOutputAssembly="False" />
  </ItemGroup>

  <ItemGroup>
    <DllFiles Include="../x64/$(Configuration)/*.dll;../x64/$(Configuration)/*.pdb" />
  </ItemGroup>

  <Target Name="CopyDLL" AfterTargets="Build">
    <Copy SourceFiles="@(DllFiles)" DestinationFolder="$(OutDir)" />
  </Target>

</Project>
```

此时, 当你构建 C# 项目, C++ 项目就会自动构建, 并拷贝构建输出到 C# 项目输出目录.

![构建带有 C++ 项目引用的 C# 项目](/images/BuildCSharpProjectWithCppProjectReference.png)