---
title: "深入 WPF 列表虚拟化与树虚拟化"
published: 2024-10-29T14:20:00
description: '高性能 = ScrollViewer + ItemsControl + VirtualizingPanel'
image: ''
tags: ['.NET', 'CSharp', 'WPF']
category: '.NET'
draft: false 
lang: ''
---

在开发一些大型软件时, 不可避免的会遇到大量数据的呈现, 例如数万, 十几万甚至上百万个数据, 需要一个列表呈现.
倘若每一个数据都真正的在界面上创建对应的控件, 那电脑的性能不管如何, 都是不够的.

这个时候, 就需要虚拟化了.

## 什么是虚拟化

简单来讲, 虚拟化就是仅呈现用户可见的数据. 不管如何, 数以万计的数据不可能同时都存在界面上, 在界面上, 一般用户都是只能看到几十条数据.

在这种情况下, 只需要保证这几十条数据有对应的控件用于呈现, 就可以节省性能.
而当用户滚动的时候, 新进入可见区域的数据会创建对应控件, 离开可视区域的数据就会销毁对应控件, 以回收性能.

当然, 除了每次滚动都需要新建与销毁控件, 也有另外一种重用控件的模式, 滚动出的内容会被滚动入内容所使用, 这样不需要新建控件, 内存稳定会好很多.

![](/images/virtualizing_tree_view.png)

900 百万条数据, 树形结构, 在界面上呈现, 最终内存占用只有 1G 多些. 其中 400MB 是 WPF 的基础占用.

## 使用虚拟化

WPF 内置了许多自带虚拟化的控件, ListBox, ListView, GridView, TreeView 都是可以直接使用的.

给 ItemsSource 属性设置数据源之后, 上述控件即可自动启用虚拟化.

![](/images/virtualizing_list_box.png)

如果要禁用虚拟化, 只需要在对应容器控件上设置附加属性 VirtualizingPanel.IsVirtualizing 为 false 即可.

## 虚拟化的不同模式

在默认模式下, 离开可视区域的数据对应的控件会被销毁. 
通过设置容器的 [VirtualizingPanel.VirtualizationMode](https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.virtualizationmode) 附加属性可以更改此行为.

| 值 | 描述 |
| --- | --- |
| Standard (默认) | 创建并且销毁对应控件 |
| Recycling | 重用对应控件 |

## 虚拟化时不同的滚动模式

在开启虚拟化时, 每次进行滚动, 默认最小的单位就不再是原来的像素, 而是一项数据.
通过设置容器的 [VirtualizingPanel.ScrollUnit](https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.scrollunit) 附加属性可以更改此行为.

| 值 | 描述 |
| --- | --- |
| Pixel | 最小的滚动单位是像素 |
| Item (默认) | 最小的滚动单位是一项数据 |

## 虚拟化的实现要求

WPF 自 .NET Framework 4.5 开始, 就提供了比较完善的虚拟化支持.

要实现虚拟化, 你需要有以下元素:

1. ScrollViewer, 用于处理滚动, 以及可见区域的计算, 并确保其 CanContentScroll 设为 true (默认是 false, 需手动设置为 true)
2. ItemsControl, 用于根据数据生成对应控件, 并确保启用虚拟化 (默认启用)
3. VirtualizingPanel, 适用于虚拟化后的界面的布局

并且, 必须保证有以下层级关系:

```
ScrollContentPresenter
|- ItemsPresenter
    |- VirtualizingPanel
```

具体的操作方式:

1. 重写 ItemsControl 的模板, 保证模板内包含一个 ScrollViewer, 且是 ItemsPresenter 的直接父节点, 并设置 ScrollViewer 的 CanContentScroll 为 True
    ```xml
    <ScrollViewer CanContentScroll="True">
        <ItemsPresenter/>
    </ScrollViewer>
    ```
2. 保证 ItemsControl 的 ItemsPanel 是一个虚拟化容器
    ```xml
    <ItemsControl>
        <ItemsControl.ItemsPanel>
            <ItemsPanelTemplate>
                <VirtualizingStackPanel />
            </ItemsPanelTemplate>
        </ItemsControl.ItemsPanel>
    </ItemsControl>
    ```

关于内置虚拟化容器, ListBox, ListView 这些控件的模板中自带 ScrollViewer, 而且它们的 ItemsPanel 默认就是 VirtualizingStackPanel, 所以无需更改就直接能进行虚拟化

## 树形结构虚拟化

在 WPF 的 TreeView 控件中, 主要需要使用 TreeView 和 TreeViewItem 这两个. 但其实, 它们都是一种 "列表容器". TreeView 和 TreeViewItem 都直接或间接的继承自 ItemsControl.

TreeViewItem 继承自 HeaderedItemsControl, 而 HeaderedItemsControl 相比较 ItemsControl, 就是多了 `Header`, `HeaderTemplate`, `HeaderTemplateSelector` 这几个属性.

TreeViewItem 的模板大致如下, 本质就是在列表的最上方, 加了一个标头:

```xml
<Grid>
    <Grid.ColumnDefinitions>
        <ColumnDefinition MinWidth="19" Width="Auto"/>
        <ColumnDefinition Width="Auto"/>
        <ColumnDefinition Width="*"/>
    </Grid.ColumnDefinitions>
    <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition/>
    </Grid.RowDefinitions>
    <ToggleButton x:Name="Expander" ClickMode="Press" IsChecked="{Binding IsExpanded, RelativeSource={RelativeSource Mode=TemplatedParent}}" Style="{StaticResource ExpandCollapseToggleStyle}"/>
    <Border x:Name="Bd" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" Grid.Column="1" Padding="{TemplateBinding Padding}" SnapsToDevicePixels="true">
        <ContentPresenter x:Name="PART_Header" ContentSource="Header" HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" SnapsToDevicePixels="{TemplateBinding SnapsToDevicePixels}"/>
    </Border>
    <ItemsPresenter x:Name="ItemsHost" Grid.Column="1" Grid.ColumnSpan="2" Grid.Row="1"/>
</Grid>
```

但能使 TreeViewItem 递归性参与 TreeView 的虚拟化的原因, 还是 [IHierarchicalVirtualizationAndScrollInfo](https://learn.microsoft.com/zh-cn/dotnet/api/system.windows.controls.primitives.ihierarchicalvirtualizationandscrollinfo) 这个接口.

在 VirtualizingStackPanel 进行虚拟化布局时, 会递归性的判断容器内的元素是否实现此接口, 并让其参与到虚拟化布局中.

不过, 通过查看 [TreeViewItem 的源代码](https://source.dot.net/#PresentationFramework/System/Windows/Controls/TreeViewItem.cs,c17a2c09aaa80559), 我们可以知道, 实现此接口并不简单, 在 WPF 自己对 TreeViewItem 的实现中, 使用了大量 internal 的代码.

## 提示与注意事项

- VirtualizingPanel.IsVirtualizing 属性是设置在 ItemsControl 上的, 也就是最外层的, 诸如 ListBox, ListView 的容器. 将它设置在 VirtualizingPanel 上不会有任何作用. 且默认的你不需要更改此值, 因为此值默认就为 true
- CanContentScroll 应该设置到 ScrollViewer 上. 此属性不会自动从父节点继承, 你应该直接在模板内就为它设置好 true, 因为此值默认为 false
- 在模板中, ScrollViewer 和 ItemsPresenter 之间不能加任何节点, 否则都会导致虚拟化失效. 这意味着你不能直接不改模板, 而是直接在 ItemsControl 外面套一个 ScrollViewer 草草了事. 你只能通过更改模板来为它添加 ScrollViewer.

