---
title: '[WPF] 实现真正的背景模糊'
slug: '20250608020400'
published: 2025-06-08T02:04:00
tags:
  - csharp
  - dotnet
  - wpf
category: 'WPF'
description: '我会是地球上第一个真正实现 WPF 背景模糊的程序员'
---

在 Web 中, 只需要一句 CSS 代码, 即可实现任何元素的背景模糊:

```css
.some-class {
    backdrop-filter: blur(10px);
}
```

但很遗憾, WPF 并不能这样实现. 一切, 都要我们自己**手搓**.



## 我们需要什么

要实现背景模糊, 我们首先需要得到背景, 再对其进行模糊. 假设我们有这样的一个层级关系:

```txt
根
 |- 某些父节点
 |   |- 某些父节点之前的兄弟
 |   |- 某些父节点之前的兄弟
 |   |- 某些父节点
 |   |   |- 某些优先绘制的兄弟
 |   |   |- 某些优先绘制的兄弟
 |   |   |- 自身
 |   |   |- 后面的兄弟
 |   |   |- 后面的兄弟...
 |   |- ...
 |- ...
```

那么我们的 "背景" 来自于所有 "在自己之前" 的**同级节点**, 自己的**父节点**, 然后是自己父节点之前的同级节点, 父节点的父节点, **如此递归. 直到取到根**.

要获取非父节点元素的内容是非常简单的, 因为**它们和我们自身是没有关系的**. 我们只需要使用 `VisualBrush`, 就可以获取到它们的内容.

但棘手的是父节点, 因为**父节点包含我们自身**, 以及我们自身后面的兄弟节点. **我们需要干净的父节点自身的内容**, 这是问题的关键.

所以接下来, 我们要做的是一个会绘制自身背景的元素.

## WPF 的渲染流程

我们知道, 如果要自定义一个元素的渲染, 只需要重写 `OnRender` 方法, 并使用传入的 DrawingContext 进行绘制即可.

通过阅读 WPF 的源代码, 我们可以发现, `OnRender` 的调用是在 [UIElement](https://learn.microsoft.com/zh-cn/dotnet/api/system.windows.uielement) 的 [Arrange](https://learn.microsoft.com/zh-cn/dotnet/api/system.windows.uielement.arrange) 方法中. 位于 [UIElement.cs 的 928 行](https://source.dot.net/#PresentationCore/System/Windows/UIElement.cs,928).

而这里的 `DrawingContext` 参数来自于 `UIElement` 的内部方法, [RenderOpen](https://source.dot.net/PresentationCore/R/b3a742a988d4f6a5.html) 中. 它其实是创建了一个内部类 `VisualDrawingContext` 的实例.

在绘制完成后, 还调用了 `DrawingContext` 的 `Close` 方法, 经过一系列调用, 最后到达了 `UIElement` 的 [RenderClose](https://source.dot.net/PresentationCore/R/c4d29c5305e78949.html) 方法. 

而 `RenderClose` 方法本质上是将 `DrawingContext` 的调用指令, 存储到了 `UIElement` 的 `_drawingContent` 字段中了.

至此, 我们可以知道, `UIElement` 如何呈现, 关键在于 `_drawingContent` 的值.

## 取得元素绘制内容

通过反射, 我们可以轻易取到 `UIElement` 的 `_drawingContent` 字段的值
```c#
private static readonly FieldInfo _drawingContentOfUIElement = typeof(UIElement)
    .GetField("_drawingContent", BindingFlags.Instance | BindingFlags.NonPublic)!;
```

```c#
Visual someVisual;
object drawingContent = _drawingContentOfUIElement.GetValue(someVisual);
```

接下来, 我们需要将其转移到一个新的 `Visual` 中, 然后绘制这个新的 `Visual`. 这里使用 `DrawingVisual`.
因为如果使用 `UIElement`, 在绘制时会调用其 `OnRender` 重新进行绘制, 这没意义. 而且据笔者实验, 这总是会产生一些闪烁问题.

```c#
private static readonly FieldInfo _contentOfDrawingVisual = typeof(DrawingVisual)
    .GetField("_content", BindingFlags.Instance | BindingFlags.NonPublic)!;
```

```c#
object drawingContentOfSomeVisual;
DrawingVisual drawingVisual = new DrawingVisual();
_contentOfDrawingVisual.SetValue(drawingVisual, drawingContentOfSomeVisual);
```

现在, 我们就可以通过 `VisualBrush` 将我们所取得的内容绘制出来了.

## 内容的刷新

因为我们的内容来自父节点, 以及在自身之前的同级节点, 所以当它们位置变动, 也就是布局更新时, 我们需要重新绘制.

这很简单, 我们只需要订阅父节点作为 UIElement 的 LayoutUpdated 事件即可:

```c#
protected override void OnVisualParentChanged(DependencyObject oldParentObject)
{
    if (oldParentObject is UIElement oldParent)
    {
        oldParent.LayoutUpdated -= ParentLayoutUpdated;
    }

    if (Parent is UIElement newParent)
    {
        newParent.LayoutUpdated += ParentLayoutUpdated;
    }
}

private void ParentLayoutUpdated(object? sender, EventArgs e)
{
    // 在这里引发重绘
}
```

不过, 这里需要注意. 不能使用 `InvalidateVisual()` 引发重绘, 因为它同样会使布局失效. 这样就造成死递归了(严格来讲会导致布局在每一帧都进行, 造成卡顿).

## 对内容进行裁剪

因为我们的渲染包含了背景的所有元素, 所以其大小也是和背景一致的. 它会覆盖整个窗口. 
所以, 我们需要重写 GetLayoutClip 来设定呈现的范围.

```c#
protected override Geometry GetLayoutClip(Size layoutSlotSize)
{
    return new RectangleGeometry(new Rect(0, 0, ActualWidth, ActualHeight));
}
```

## 结合在一起

所有的所有, 结合在一起, 我们得到了一个背景呈现元素, 再对其添加 BlurEffect 效果, 就是实时背景模糊:

![realtime background blur effect](/images/wpf_background_blur.gif)

背景呈现元素的完整代码:

```c#
public class BackgroundPresenter : FrameworkElement
{
    private static readonly FieldInfo _drawingContentOfUIElement = typeof(UIElement)
        .GetField("_drawingContent", BindingFlags.Instance | BindingFlags.NonPublic)!;

    private static readonly FieldInfo _contentOfDrawingVisual = typeof(DrawingVisual)
        .GetField("_content", BindingFlags.Instance | BindingFlags.NonPublic)!;

    private static readonly FieldInfo _offsetOfVisual = typeof(Visual)
        .GetField("_offset", BindingFlags.Instance | BindingFlags.NonPublic)!;

    private static readonly Func<UIElement, DrawingContext> _renderOpenMethod = typeof(UIElement)
        .GetMethod("RenderOpen", BindingFlags.Instance | BindingFlags.NonPublic)!
        .CreateDelegate<Func<UIElement, DrawingContext>>();

    private static readonly Action<UIElement, DrawingContext> _onRenderMethod = typeof(UIElement)
        .GetMethod("OnRender", BindingFlags.Instance | BindingFlags.NonPublic)!
        .CreateDelegate<Action<UIElement, DrawingContext>>();

    private static readonly GetContentBoundsDelegate _methodGetContentBounds = typeof(VisualBrush)
        .GetMethod("GetContentBounds", BindingFlags.Instance | BindingFlags.NonPublic)!
        .CreateDelegate<GetContentBoundsDelegate>();

    private delegate void GetContentBoundsDelegate(VisualBrush visualBrush, out Rect bounds);
    private readonly Stack<UIElement> _parentStack = new();

    private static void ForceRender(UIElement target)
    {
        using DrawingContext drawingContext = _renderOpenMethod(target);

        _onRenderMethod.Invoke(target, drawingContext);
    }

    private static void DrawVisual(DrawingContext drawingContext, Visual visual, Point relatedXY, Size renderSize)
    {
        var visualBrush = new VisualBrush(visual);
        var visualOffset = (Vector)_offsetOfVisual.GetValue(visual)!;

        _methodGetContentBounds.Invoke(visualBrush, out var contentBounds);
        relatedXY -= visualOffset;

        drawingContext.DrawRectangle(
            visualBrush, null,
            new Rect(relatedXY.X + contentBounds.X, relatedXY.Y + contentBounds.Y, contentBounds.Width, contentBounds.Height));
    }

    protected override Geometry GetLayoutClip(Size layoutSlotSize)
    {
        return new RectangleGeometry(new Rect(0, 0, ActualWidth, ActualHeight));
    }

    protected override void OnVisualParentChanged(DependencyObject oldParentObject)
    {
        if (oldParentObject is UIElement oldParent)
        {
            oldParent.LayoutUpdated -= ParentLayoutUpdated;
        }

        if (Parent is UIElement newParent)
        {
            newParent.LayoutUpdated += ParentLayoutUpdated;
        }
    }

    private void ParentLayoutUpdated(object? sender, EventArgs e)
    {
        // cannot use 'InvalidateVisual' here, because it will cause infinite loop

        ForceRender(this);

        Debug.WriteLine("Parent layout updated, forcing render of BackgroundPresenter.");
    }

    private static void DrawBackground(
        DrawingContext drawingContext, UIElement self,
        Stack<UIElement> parentStackStorage,
        int maxDepth,
        bool throwExceptionIfParentArranging)
    {
#if DEBUG
        bool selfInDesignMode = DesignerProperties.GetIsInDesignMode(self);
#endif

        var parent = VisualTreeHelper.GetParent(self) as UIElement;
        while (
            parent is { } &&
            parentStackStorage.Count < maxDepth)
        {
            // parent not visible, no need to render
            if (!parent.IsVisible)
            {
                parentStackStorage.Clear();
                return;
            }

#if DEBUG
            if (selfInDesignMode &&
                parent.GetType().ToString().Contains("VisualStudio"))
            {
                // 遍历到 VS 自身的设计器元素, 中断!
                break;
            }
#endif

            // is parent arranging
            // we cannot render it
            if (parent.RenderSize.Width == 0 ||
                parent.RenderSize.Height == 0)
            {
                parentStackStorage.Clear();

                if (throwExceptionIfParentArranging)
                {
                    throw new InvalidOperationException("Arranging");
                }

                // render after parent arranging finished
                self.InvalidateArrange();
                return;
            }

            parentStackStorage.Push(parent);
            parent = VisualTreeHelper.GetParent(parent) as UIElement;
        }

        var selfRect = new Rect(0, 0, self.RenderSize.Width, self.RenderSize.Height);
        while (parentStackStorage.TryPop(out var currentParent))
        {
            if (!parentStackStorage.TryPeek(out var breakElement))
            {
                breakElement = self;
            }

            var parentRelatedXY = currentParent.TranslatePoint(default, self);

            // has render data
            if (_drawingContentOfUIElement.GetValue(currentParent) is { } parentDrawingContent)
            {
                var drawingVisual = new DrawingVisual();
                _contentOfDrawingVisual.SetValue(drawingVisual, parentDrawingContent);

                DrawVisual(drawingContext, drawingVisual, parentRelatedXY, currentParent.RenderSize);
            }

            if (currentParent is Panel parentPanelToRender)
            {
                foreach (UIElement child in parentPanelToRender.Children)
                {
                    if (child == breakElement)
                    {
                        break;
                    }

                    var childRelatedXY = child.TranslatePoint(default, self);
                    var childRect = new Rect(childRelatedXY, child.RenderSize);

                    if (!selfRect.IntersectsWith(childRect))
                    {
                        continue; // skip if not intersecting
                    }

                    if (child.IsVisible)
                    {
                        DrawVisual(drawingContext, child, childRelatedXY, child.RenderSize);
                    }
                }
            }
        }
    }

    public static void DrawBackground(DrawingContext drawingContext, UIElement self)
    {
        var parentStack = new Stack<UIElement>();
        DrawBackground(drawingContext, self, parentStack, int.MaxValue, true);
    }

    protected override void OnRender(DrawingContext drawingContext)
    {
        DrawBackground(drawingContext, this, _parentStack, MaxDepth, false);
    }

    public int MaxDepth
    {
        get { return (int)GetValue(MaxDepthProperty); }
        set { SetValue(MaxDepthProperty, value); }
    }

    public static readonly DependencyProperty MaxDepthProperty =
        DependencyProperty.Register("MaxDepth", typeof(int), typeof(BackgroundPresenter), new PropertyMetadata(64));
}
```

## 仓库

完整的测试代码仓库如下:

::github{repo="SlimeNull/BlurBehindTest"}

在之后, 我打算将其封装成更多易用的控件, 并添加到 WPF Suite 中. 敬请期待!

::github{repo="OrgEleCho/EleCho.WpfSuite"}