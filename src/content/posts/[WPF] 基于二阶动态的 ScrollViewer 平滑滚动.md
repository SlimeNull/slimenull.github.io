---
title: '[WPF] 基于二阶系统的 ScrollViewer 平滑滚动'
slug: '20250608004400'
published: 2025-06-08T00:44:00
tags:
  - csharp
  - dotnet
  - wpf
category: 'WPF'
description: '你在网上查到的大多是基于动画或者速度与加速度的仿真实现的平滑滚动, 但这里有基于自控二阶系统的仿真滚动'
---

如何让动画看起来真实? 用真实的方法控制它就好了

## 数据的平滑

在 YouTube 上, 有一位大佬做了一个这样的基于二阶系统的缓动: [t3ssel8r - Giving Personality to Procedural Animations using Math](https://www.youtube.com/watch?v=KPoeNZZ6H4s)

由此, 我们可以封装一个这样的数据平滑处理类:

```c#
internal class SecondOrderDynamics
{
    private double _xp;// previous input
    private double _y, _yd; // state variables
    private double _w, _z, _d, k1, k2, k3; // dynamics constants
    private double _r;
    private double _f;

    /// <summary>
    /// 频率
    /// - 即速度, 单位是赫兹(Hz)
    /// - 不会影响输出结果的形状, 会影响 '震荡频率'
    /// </summary>
    public double F
    {
        get => _f; set
        {
            _f = value;
            InitMotionValues(_f, _z, _r);
        }
    }

    /// <summary>
    /// 阻尼 <br />
    /// - 当为 0 时, 输出将永远震荡不衰减 <br />
    /// - 当大于 0 小于 1 时, 输出会超出结果, 并逐渐趋于目标 <br />
    /// - 当为 1 时, 输出的曲线是趋向结果, 并正好在指定频率对应时间内抵达结果 <br />
    /// - 当大于 1 时, 输出值同样时取向结果, 但速度会更慢, 无法在指定频率对应时间内抵达结果 <br />
    /// </summary>
    public double Z
    {
        get => _z; set
        {
            _z = value;
            InitMotionValues(_f, _z, _r);
        }
    }

    /// <summary>
    /// 初始响应
    /// - 当为 0 时, 数据需要进行 '加速' 来开始运动 <br />
    /// - 当为 1 时, 数据会立即开始响应 <br />
    /// - 当大于 1 时, 输出会因为 '速度过快' 而超出目标结果  <br />
    /// - 当小于 0 时, 输出会 '预测运动', 即 '抬手动作'. 例如目标是 '加' 时, 输出会先进行 '减', 再进行 '加', 
    /// - 当运动目标为机械时, 通常取值为 2
    /// </summary>
    public double R
    {
        get => _r; set
        {
            _r = value;
            InitMotionValues(_f, _z, _r);
        }
    }

    public SecondOrderDynamics(double f, double z, double r, double x0)
    {
        //compute constants
        InitMotionValues(f, z, r);

        // initialize variables
        _xp = x0;
        _y = x0;
        _yd = 0;
    }

    private void InitMotionValues(double f, double z, double r)
    {
        _w = 2 * Math.PI * f;
        _z = z;
        _d = _w * Math.Sqrt(Math.Abs(z * z - 1));
        k1 = z / (Math.PI * f);
        k2 = 1 / ((2 * Math.PI * f) * (2 * Math.PI * f));
        k3 = r * z / (2 * Math.PI * f);
    }

    public double Update(double deltaTime, double x, out double yd)
    {
        double xd = (x - _xp) / deltaTime;
        double k1_stable, k2_stable;

        if (_w * deltaTime < _z)
        {
            k1_stable = k1;
            k2_stable = Math.Max(Math.Max(k2, deltaTime * deltaTime / 2 + deltaTime * k1 / 2), deltaTime * k1);
        }
        else
        {
            double t1 = Math.Exp(-_z * _w * deltaTime);
            double alpha = 2 * t1 * (_z <= 1 ? Math.Cos(deltaTime * _d) : Math.Cosh(deltaTime * _d));
            double beta = t1 * t1;
            double t2 = deltaTime / (1 + beta - alpha);
            k1_stable = (1 - beta) * t2;
            k2_stable = deltaTime * t2;
        }

        _y = _y + deltaTime * _yd;
        _yd = _yd + deltaTime * (x + k3 * xd - _y - k1_stable * _yd) / k2_stable;

        _xp = x;

        yd = _yd;
        return _y;
    }

    public double Update(double deltaTime, double x) 
        => Update(deltaTime, x, out _);
}
```

使用它的方式, 就是逐帧的调用 Update 方法, deltaTime 传入距离上次调用所经过的时间, x 传入当前所需的值, 返回的结果则是经过平滑处理的数据.

如果你用过 Unity, 那你一定知道 [SmoothDamp](https://docs.unity.cn/cn/current/ScriptReference/Mathf.SmoothDamp.html), 在上面我们封装好的这个类中, 当 Z 是 1, R 是 0 时, 其呈现的效果, 与 SmoothDamp 一致.

假设我们期望平滑后的数据在约莫 0.1s 后抵达目标值, 那么 F 应该传入 10.


## 在 WPF 中逐帧进行平滑

WPF 中, 每一帧进行渲染时, 都会触发 [CompositionTarget.Rendering](https://learn.microsoft.com/zh-cn/dotnet/api/system.windows.media.compositiontarget.rendering) 事件.

需要注意的是, 为了避免内存泄漏, 我们应该在当前控件脱离可视化树的时候, 取消注册 Rendering 事件.

有了这个, 我们只需要在鼠标进行滚动的时候, 记录目标值, 并且在每帧调用二阶系统缓动对数据做平滑, 再将 ScrollViewer 滚动到平滑后的位置即可.

```c#
internal class SmoothScrollViewer : ScrollViewer
{
    protected override void OnVisualParentChanged(DependencyObject oldParent)
    {
        // 确保取消注册
        CompositionTarget.Rendering -= CompositionTargetRendering;

        if (VisualParent is not null)
        {
            // 如果新的 Parent 不为空, 也就是当前控件在可视化树上
            // 则注册 Rendering 事件

            CompositionTarget.Rendering += CompositionTargetRendering;
        }

        base.OnVisualParentChanged(oldParent);
    }

    private readonly Stopwatch _stopwatch = Stopwatch.StartNew();

    private double _scrollingTarget = double.NaN;       // 滚动目标
    private SecondOrderDynamics? _scrollingDynamics;    // 缓动对象
    private TimeSpan _lastRenderTime;                   // 上一次渲染时间

    private void CompositionTargetRendering(object? sender, EventArgs e)
    {
        var totalElapsed = _stopwatch.Elapsed;
        var elapsedSeconds = (totalElapsed - _lastRenderTime).TotalSeconds;
        _lastRenderTime = totalElapsed;

        if (double.IsNaN(_scrollingTarget))
        {
            _scrollingDynamics = null;
            return;
        }

        // 确保用于缓动对象已创建
        _scrollingDynamics ??= new(3, 1, 0, VerticalOffset);

        // 更新滚动值
        var animatedOffset = _scrollingDynamics.Update(elapsedSeconds, _scrollingTarget, out var yd);
        ScrollToVerticalOffset(animatedOffset);

        // 速度接近0, 结束滚动
        if (Math.Abs(yd) < 0.05)
        {
            _scrollingTarget = double.NaN;
            _scrollingDynamics = null;
        }
    }

    protected override void OnMouseWheel(MouseWheelEventArgs e)
    {
        // 如果当前没有滚动目标, 则设置新的滚动目标
        if (double.IsNaN(_scrollingTarget))
        {
            _scrollingTarget = VerticalOffset - e.Delta;
        }
        else
        {
            _scrollingTarget -= e.Delta;
        }
    }
}
```

效果如下:

![preview](/images/smooth_scrolling_with_two_order_system.gif)

## 使用 WPF Suite

上面已经实现了最简单的平滑滚动, 但是滚动也可能是横向的, 或者是由触摸板, 笔, 或者触摸设备引发的.

而且要考虑到易用性, 还需要允许用户可以自定义平滑时间, 也需要能够通过属性来禁用平滑滚动行为.

如果要全部考虑进去, 那么代码量就多了. 不妨试试我封装好的 ScrollViewer, 只需要安装 [EleCho.WpfSuite](https://www.nuget.org/packages/EleCho.WpfSuite) 包, 引入命名空间, 然后使用就可以了.

```xml
<Window x:Class="SmoothScrollingTest.MainWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:ws="https://schemas.elecho.dev/wpfsuite"
        Title="MainWindow" Height="450" Width="800">
    <ws:ScrollViewer >
        <StackPanel x:Name="panel" />
    </ws:ScrollViewer>
</Window>
```

::github{repo="OrgEleCho/EleCho.WpfSuite"}




## 引用

- [TwilightLemon - WPF 使用CompositionTarget.Rendering实现平滑流畅滚动的ScrollViewer，支持滚轮、触控板、触摸屏和笔](https://www.cnblogs.com/TwilightLemon/p/18909374)

- [t3ssel8r - Giving Personality to Procedural Animations using Math](https://www.youtube.com/watch?v=KPoeNZZ6H4s)