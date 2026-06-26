---
title: '高级 JSON 序列化, 基于反射和动态代理将复杂的, 带循环引用的, 多态的数据序列化与反序列化'
published: 2026-06-26
description: '基于反射和动态代理将复杂的, 带循环引用的, 多态的数据序列化与反序列化. 通过自定义转换器, 实现几乎任意数据类型的序列化与反序列化.'
image: ''
tags: ['csharp', 'JSON']
category: ''
draft: false 
lang: ''
---

你的领导突然要你做跨进程的插件开发, 但项目已经有一套 API 抽象了,
你不希望重新再抽一套, 于是决定将原有进程内插件的复杂数据抽象, 序列化成 JSON, 再通过命名管道发送到另一个进程.
但问题是, 这套数据是复杂的, 带循环引用的, 多态的, 基于接口的. 并且你不希望为了跨进程通信再写一次接口的实现类.

> 本文基于 System.Text.Json, 并且需要使用 Castle.Core 中的动态代理

本文解决的是这类问题:

- 对象之间存在互相引用, 不能因为循环引用导致序列化失败
- 成员类型是接口, 反序列化时没有现成实现类可以 new
- 对象运行时类型比声明类型更具体, 序列化时不能丢失派生类型成员
- 某些值类型只有 `Parse(string)`, 不想为每个类型单独写转换器
- 某些类型没有无参构造函数, 或者集合属性只读, 但反序列化时仍然希望还原数据

简单说, 我们不是要做一个普通的 DTO JSON 序列化, 而是要尽量把一张复杂的对象图保存下来, 之后再还原成能够继续使用的对象图.

## 如何解决循环引用

假如你有两个类型:

```cs
class A { public B Other { get; set; } }
class B { public A Other { get; set; } }
```

它们明显互相引用, 但你希望能够正确的序列化它, 那么使用 System.Text.Json 中的 ReferenceHandler.Preserve 可以轻易解决这个需求.

在 JsonSerializerOptions 中指定 ReferenceHandler, 你就可以直接跑通下面明显带有循环引用的对象序列化了

```cs
using System.Text.Json;
using System.Text.Json.Serialization;

var a = new A();
var b = new B();
a.Other = b;
b.Other = a;

var jsonSerializerOptions = new JsonSerializerOptions()
{
    ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.Preserve
};

var json = JsonSerializer.Serialize(a, jsonSerializerOptions);
Console.WriteLine(json);
```

它将输出:

```json
{"$id":"1","Other":{"$id":"2","Other":{"$ref":"1"}}}
```

当然, 你也可以将它重新序列化到 C# 对象, 对象引用关系仍然存在:

```cs
var objRoot = JsonSerializer.Deserialize<A>(json, jsonSerializerOptions);
Console.WriteLine(objRoot.GetHashCode());
Console.WriteLine(objRoot.Other.Other.GetHashCode());
```

由于两个对象是同一个对象, 上述两个 `Console.WriteLine` 输出的哈希值是相同的.

`ReferenceHandler` 是一个抽象类, 它包含一个 `CreateResolver` 方法, 用来创建一个实际存储容器, 它用来添加引用或从存储中取得引用.

当 JSON 反序列化的时候, 遇到 `$id` 节点, 它就会将它加入到 `ReferenceResolver` 中, 在后续遇到 `$ref` 节点时, 再从中取出.

## 自定义 ReferenceHandler 以保证多个序列化调用使用同一引用存储

JSON 反序列化的时候, 如果我们使用了自定义的转换器, 即便当前对象是前面对象的引用, System.Text.Json 也会调用我们的转换器.

这会导致在我们在自定义转换器中使用 `Utf8JsonReader` 读取到的节点只是一个带有 `$ref` 属性的空节点, 但在转换器中, 我们还没办法拿到 `ReferenceResolver` 来手动解析对象引用.
并且, 即便我们不手动通过 `reader` 解析, 而是在转换器内继续调用 `JsonSerializer.Deserialize` 并传入原有 `reader`, `typeToConvert` 和 `options`, 由于这是两次调用, 它也没办法成功解析引用.

所以: 我们需要自己定义一个 `ReferenceHandler`, 以做到:

1. 使其在多次 `Deserialize` 调用中能够共享引用解析存储
2. 能够让我们自己的转换器解析引用

所以, 我们需要创建一个和 `ReferenceHandler.Preserve` 行为一致的, 但是多次调用 `CreateResolver` 时只返回同一个对象的实现. 并且为了避免反序列化的时候拿到 "上一次反序列化" 时加入的引用, 它还应当有 `Reset` 方法用于重置存储.

> 文档参考: [如何在 System.Text.Json 中保留引用并处理或忽略循环引用](https://learn.microsoft.com/zh-cn/dotnet/standard/serialization/system-text-json/preserve-references)

```cs
class PreserveReferenceResolver : ReferenceResolver
{
    private uint _referenceCount;
    private readonly Dictionary<string, object> _referenceIdToObjectMap = [];
    private readonly Dictionary<object, string> _objectToReferenceIdMap = new (ReferenceEqualityComparer.Instance);

    public override void AddReference(string referenceId, object value)
    {
        if (!_referenceIdToObjectMap.TryAdd(referenceId, value))
        {
            throw new JsonException();
        }
    }

    public override string GetReference(object value, out bool alreadyExists)
    {
        if (_objectToReferenceIdMap.TryGetValue(value, out string? referenceId))
        {
            alreadyExists = true;
        }
        else
        {
            _referenceCount++;
            referenceId = _referenceCount.ToString();
            _objectToReferenceIdMap.Add(value, referenceId);
            alreadyExists = false;
        }

        return referenceId;
    }

    public override object ResolveReference(string referenceId)
    {
        if (!_referenceIdToObjectMap.TryGetValue(referenceId, out object? value))
        {
            throw new JsonException();
        }

        return value;
    }
}

class SingletonReferenceHandler : ReferenceHandler
{
    public SingletonReferenceHandler() => Reset();
    private ReferenceResolver? _rootedResolver;
    public override ReferenceResolver CreateResolver() => _rootedResolver!;
    public void Reset() => _rootedResolver = new PreserveReferenceResolver();

    public static void AddReferenceIsNecessary(JsonObject jsonObject, object value, JsonSerializerOptions options)
    {
        if (jsonObject.TryGetPropertyValue("$id", out var propertyValueNode) &&
            propertyValueNode is not null &&
            propertyValueNode.GetValueKind() == JsonValueKind.String)
        {
            if (options?.ReferenceHandler is SingletonReferenceHandler referenceHandler)
            {
                referenceHandler.CreateResolver().AddReference(propertyValueNode.GetValue<string>(), value);
            }
            else
            {
                throw new InvalidOperationException("Can not add reference");
            }
        }
    }

    public static bool TryResolveReference(JsonObject jsonObject, JsonSerializerOptions options, [NotNullWhen(true)] out object? value)
    {
        if (jsonObject.TryGetPropertyValue("$ref", out var propertyValueNode) &&
            propertyValueNode is not null &&
            propertyValueNode.GetValueKind() == JsonValueKind.String)
        {
            if (options?.ReferenceHandler is SingletonReferenceHandler referenceHandler)
            {
                value = referenceHandler.CreateResolver().ResolveReference(propertyValueNode.GetValue<string>());
                return true;
            }
            else
            {
                throw new InvalidOperationException("Can not resolve reference");
            }
        }

        value = null;
        return false;
    }
}
```

这样:

1. 在转换器内调用 `Serialize` / `Deserialize` 的时候, 它们共享引用, 就不会出现 id 冲突或者无法解析引用的情况了
2. 在转换器内添加引用或解引用的时候, 调用上面写的静态方法即可.

使用时建议把这个 `SingletonReferenceHandler` 当成一次序列化或反序列化流程的上下文对象, 每次开始前都调用一次 `Reset`:

```cs
var referenceHandler = new SingletonReferenceHandler();

var options = new JsonSerializerOptions()
{
    ReferenceHandler = referenceHandler,
    WriteIndented = true
};

referenceHandler.Reset();
var json = JsonSerializer.Serialize(rootObject, options);

referenceHandler.Reset();
var restored = JsonSerializer.Deserialize<RootObject>(json, options);
```

这里有一个容易踩坑的地方: `JsonSerializerOptions` 可以复用, 但引用解析器中的对象映射不能跨业务请求复用. 如果不 `Reset`, 下一次反序列化可能会拿到上一次 JSON 中注册过的对象, 结果就非常玄学.

> 当然, 如果你每次序列化或反序列化时都创建新的 Options 对象, 并且每次都创建新的 ReferenceHandler 对象, 那上面说的问题也就不存在了


值得一提的是, 之所以我们不直接在 `SingletonReferenceHandler` 中使用 `ReferenceHandler.Preserve.CreateResolver` 而是自己写一个 resolver 并实例化它,
是因为库自带的 Preserve 实现的 `CreateResolver` 会直接丢给你一个 `InvalidOperation` 异常. 库内部专门判断了 "这个类型是不是我内置的 Handler", 如果是, 它会调用一个 internal 方法.

但既然是 internal, 我们自然无法调用或实现了. 而刚刚提到的 `CreateResolver` 实现, 内部实现就是一句 `throw new InvalidOperationException()`

## 基于动态代理, 在无需实体类的情况下反序列化接口

接下来, 我们需要继续创建一个转换器, 转换器的逻辑是创建一个动态代理对象用来表示接口反序列化的对象. 而代理执行的逻辑, 则是通过从 `reader` 中读出的 `JsonNode`, 继续调用 `Deserialize` 反序列化接口的成员.

```cs
public class InterfaceProxyConverter : JsonConverter<object>
{
    public List<Type> TypesToProxy { get; } = new List<Type>();
    public List<Assembly> TypeLookupAssemblies { get; } = new();

    public override bool CanConvert(Type typeToConvert)
    {
        if (!typeToConvert.IsInterface)
        {
            return false;
        }

        foreach (var typeToProxy in TypesToProxy)
        {
            if (typeToProxy.IsAssignableFrom(typeToConvert))
            {
                return true;
            }
        }

        return false;
    }

    private class InterfaceInterceptor : IInterceptor
    {
        private readonly Type _targetInterface;
        private readonly JsonObject _payload;
        private readonly JsonSerializerOptions _deserializeOptions;

        private readonly Dictionary<string, object?> _propertyCache = new Dictionary<string, object?>();

        public InterfaceInterceptor(Type targetInterface, JsonObject payload, JsonSerializerOptions deserializeOptions)
        {
            _targetInterface = targetInterface;
            _payload = payload;
            _deserializeOptions = deserializeOptions;
        }

        private static bool IsPropertyGetInvocation(IInvocation invocation, out string propertyName)
        {
            propertyName = null!;

            var method = invocation.Method;

            if (!method.IsSpecialName ||
                !method.Name.StartsWith("get_", StringComparison.Ordinal) ||
                method.GetParameters().Length != 0 ||
                method.ReturnType == typeof(void))
            {
                return false;
            }

            propertyName = method.Name.Substring("get_".Length);
            return propertyName.Length > 0;
        }

        private object? VisitProperty(string propertyName, Type propertyType)
        {
            if (_propertyCache.TryGetValue(propertyName, out var cachedValue))
            {
                return cachedValue;
            }

            if (!_payload.TryGetPropertyValue(propertyName, out var propertyValueNode))
            {
                return null;
            }

            var createdValue = JsonSerializer.Deserialize(propertyValueNode, propertyType, _deserializeOptions);
            _propertyCache[propertyName] = createdValue;

            return createdValue;
        }

        public void WallAllProperties()
        {
            var interfaceProperties = _targetInterface.GetInterfaces()
                .Append(_targetInterface)
                .SelectMany(inter => inter.GetProperties())
                .DistinctBy(prop => prop.Name)
                .ToArray();

            foreach (var property in interfaceProperties)
            {
                VisitProperty(property.Name, property.PropertyType);
            }
        }

        public void Intercept(IInvocation invocation)
        {
            if (!IsPropertyGetInvocation(invocation, out var propertyName))
            {
                return;
            }

            invocation.ReturnValue = VisitProperty(propertyName, invocation.Method.ReturnType);
        }
    }

    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }

        var node = JsonNode.Parse(ref reader);

        if (node is not JsonObject payload)
        {
            throw new JsonException($"Expected JSON object for interface type '{typeToConvert}'.");
        }

        if (SingletonReferenceHandler.TryResolveReference(payload, options, out var referenceValue))
        {
            return referenceValue;
        }

        if (payload.TryGetPropertyValue("$type", out var typeJson) &&
            typeJson is not null &&
            typeJson.GetValueKind() == JsonValueKind.String)
        {
            typeToConvert = TypeLookupAssemblies
                .Select(asm => asm.GetType(typeJson.GetValue<string>()))
                .Where(t => t is not null)
                .First()!;
        }

        var proxyGenerator = new ProxyGenerator();
        var interceptor = new InterfaceInterceptor(typeToConvert, payload, options);
        var proxy = proxyGenerator.CreateInterfaceProxyWithoutTarget(typeToConvert, interceptor);
        SingletonReferenceHandler.AddReferenceIsNecessary(payload, proxy, options);

        interceptor.WallAllProperties();

        return proxy;
    }

    public override void Write(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
    {
        throw new NotSupportedException();
    }
}
```

这个转换器的核心思路是:

1. `CanConvert` 只处理接口类型, 并且要求这个接口属于 `TypesToProxy` 指定的接口体系
2. `Read` 先把当前 JSON 对象读成 `JsonObject`, 这样后续可以按属性名取值
3. 如果 JSON 里是 `{ "$ref": "..." }`, 就直接从 `SingletonReferenceHandler` 中解析已有对象
4. 如果 JSON 里有 `$type`, 就把目标接口切换成 `$type` 指向的接口
5. 使用 Castle DynamicProxy 创建一个没有实际目标对象的接口代理
6. 属性 getter 被调用时, 代理从 JSON 中取出对应属性节点, 再用 `JsonSerializer.Deserialize` 递归还原属性值

`WallAllProperties` 看起来有些奇怪, 但它很重要. 它会在代理创建后主动访问所有属性, 让子对象尽早反序列化出来. 这样当对象图里存在 A 引用 B, B 又引用 A 时, 引用表中能尽快注册完整对象, 后续 `$ref` 才能正确解析.

举个接口反序列化的例子:

```cs
public interface INode
{
    string Name { get; }
    INode? Parent { get; }
    IReadOnlyList<INode> Children { get; }
}

public interface IFolderNode : INode
{
    string Path { get; }
}

var referenceHandler = new SingletonReferenceHandler();

var interfaceProxyConverter = new InterfaceProxyConverter();
interfaceProxyConverter.TypesToProxy.Add(typeof(INode));
interfaceProxyConverter.TypeLookupAssemblies.Add(typeof(INode).Assembly);

var options = new JsonSerializerOptions()
{
    ReferenceHandler = referenceHandler,
    WriteIndented = true,
    Converters =
    {
        interfaceProxyConverter
    }
};

var json = """
{
  "$id": "1",
  "$type": "IFolderNode",
  "Name": "root",
  "Path": "/",
  "Parent": null,
  "Children": {
    "$id": "2",
    "$values": [
      {
        "$id": "3",
        "$type": "IFolderNode",
        "Name": "child",
        "Path": "/child",
        "Parent": { "$ref": "1" },
        "Children": {
          "$id": "4",
          "$values": []
        }
      }
    ]
  }
}
""";

referenceHandler.Reset();
var node = JsonSerializer.Deserialize<INode>(json, options)!;

Console.WriteLine(node.Name);                       // root
Console.WriteLine(node.Children[0].Name);           // child
Console.WriteLine(node.Children[0].Parent == node); // True
```

注意, 上面的 `$type` 写的是接口名, 所以 `TypeLookupAssemblies` 中必须能找到这个接口. 如果类型有命名空间, 需要写完整名称, 例如 `Demo.IFolderNode`.


## 大量自定义类型的自定义转换

你的项目中可能定义了大量的基本数据类型, 例如 double2, int3x3 这类表示向量或矩阵的类型. 但幸运的是, 它们都有静态的 `Parse` 方法.

非常好, 这样我们就可以用一个转换器基于反射解决它们的序列化和反序列化了.

```cs
public class CommonParseConverter : JsonConverter<object>
{
    private static readonly Type[] _requiredParseMethodParameters = new[] { typeof(string) };
    private readonly Dictionary<Type, MethodInfo?> _parseMethods = new Dictionary<Type, MethodInfo?>();

    private static MethodInfo? FindParseMethod(Type type)
        => type.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, null, _requiredParseMethodParameters, null);

    public override bool CanConvert(Type typeToConvert)
    {
        if (Nullable.GetUnderlyingType(typeToConvert) is { } nullableActualType)
        {
            typeToConvert = nullableActualType;
        }

        if (typeToConvert == typeof(bool) ||
            typeToConvert == typeof(decimal) ||
            typeToConvert == typeof(string) ||
            typeToConvert == typeof(DateTime) ||
            typeToConvert == typeof(DateTimeOffset) ||
            typeToConvert == typeof(Guid) ||
            typeToConvert == typeof(TimeSpan) ||
            typeToConvert == typeof(Uri) ||
            typeToConvert == typeof(Version) ||
            typeToConvert.IsEnum ||
            typeToConvert.IsPrimitive)
        {
            return false;
        }

        if (!_parseMethods.TryGetValue(typeToConvert, out var parseMethod))
        {
            _parseMethods[typeToConvert] = parseMethod = FindParseMethod(typeToConvert);
        }

        return parseMethod is not null;
    }

    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return default;
        }

        if (reader.TokenType != JsonTokenType.String)
        {
            throw new JsonException($"Expected string token, but got {reader.TokenType}.");
        }

        if (Nullable.GetUnderlyingType(typeToConvert) is { } nullableActualType)
        {
            typeToConvert = nullableActualType;
        }

        var text = reader.GetString()!;
        return _parseMethods[typeToConvert]!.Invoke(null, new object[] { text });
    }

    public override void Write(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        if (value is IConvertible convertible)
        {
            writer.WriteStringValue(convertible.ToString(CultureInfo.InvariantCulture));
        }
        else
        {
            writer.WriteStringValue(value.ToString());
        }
    }
}
```

上面的转换器支持任意带有静态 Parse(string) 的类型.

例如:

```cs
public readonly struct Double2
{
    public double X { get; }
    public double Y { get; }

    public Double2(double x, double y)
    {
        X = x;
        Y = y;
    }

    public static Double2 Parse(string text)
    {
        var parts = text.Split(',');
        return new Double2(
            double.Parse(parts[0], CultureInfo.InvariantCulture),
            double.Parse(parts[1], CultureInfo.InvariantCulture));
    }

    public override string ToString()
        => $"{X.ToString(CultureInfo.InvariantCulture)},{Y.ToString(CultureInfo.InvariantCulture)}";
}

public class TransformInfo
{
    public Double2 Position { get; set; }
}

var options = new JsonSerializerOptions()
{
    Converters =
    {
        new CommonParseConverter()
    }
};

var obj = JsonSerializer.Deserialize<TransformInfo>(
    """{ "Position": "10.5,20.25" }""",
    options)!;

Console.WriteLine(obj.Position.X); // 10.5
```

它的原理很直接: `CanConvert` 通过反射查找目标类型是否有公开静态 `Parse(string)` 方法, 有就让这个转换器接管. 读取 JSON 时要求当前 token 是字符串, 然后调用 `Parse`. 写入 JSON 时则调用 `ToString`.

这里要注意两点:

1. `ToString` 和 `Parse` 的格式必须互相匹配, 否则序列化后就反序列化不回去了
2. 最好使用 `CultureInfo.InvariantCulture`, 不要让小数点格式受系统区域设置影响

## 自动处理类型和接口多态

System.Text.Json 原生支持多态序列化和反序列化, 但是要求你往目标基类上添加特性标记

```cs
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$discriminator")]
[JsonDerivedType(typeof(ThreeDimensionalPoint), typeDiscriminator: "3d")]
public class BasePoint { }
```

使用自定义类型转换器, 自己写入类型名称到 `$type` 属性, 并且反序列化的时候自己读, 就可以实现在不添加特性的情况下自动处理多态了.

```cs
public class AutoPolymorphicConverter<T> : JsonConverter<T>
    where T : class
{
    public bool IsForInterface { get; set; }
    public List<Assembly> TypeLookupAssemblies { get; } = new();

    public override bool CanConvert(Type typeToConvert)
        => typeToConvert == typeof(T);

    private static Type FindMaxInterface(Type type)
    {
        var maxInterface = typeof(T);
        var typeInterfaces = type.GetInterfaces();

        bool continueIterate = true;
        while (continueIterate)
        {
            continueIterate = false;
            foreach (var typeInterface in typeInterfaces)
            {
                if (typeInterface != maxInterface &&
                    maxInterface.IsAssignableFrom(typeInterface))
                {
                    maxInterface = typeInterface;
                    continueIterate = true;
                }
            }
        }

        return maxInterface;
    }

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        var finalType = IsForInterface ?
            FindMaxInterface(value.GetType()) :
            value.GetType();

        var node = JsonSerializer.SerializeToNode(value, finalType, options);

        if (node is JsonObject jObj)
        {
            jObj["$type"] = finalType.FullName;
            jObj.WriteTo(writer, options);
        }
        else
        {
            writer.WriteNullValue();
        }
    }

    public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return default;
        }

        var node = JsonNode.Parse(ref reader);

        if (node is not JsonObject payload)
        {
            throw new JsonException($"Expected JSON object for interface type '{typeToConvert}'.");
        }

        if (SingletonReferenceHandler.TryResolveReference(payload, options, out var referenceValue))
        {
            return (T)referenceValue;
        }

        if (payload.TryGetPropertyValue("$type", out var typeJson) &&
            typeJson is not null &&
            typeJson.GetValueKind() == JsonValueKind.String)
        {
            typeToConvert = TypeLookupAssemblies
                .Select(asm => asm.GetType(typeJson.GetValue<string>()))
                .Where(t => t is not null)
                .First()!;

            payload.Remove("$type");
        }

        var value = JsonSerializer.Deserialize(payload, typeToConvert, options)!;

        return (T?)value;
    }
}
```

于是, 当你有这样的类型时:

```cs
class A { public string? MemberA { get; set; } public string SomePropertyOnlyInClass => "balabala"; }
class B : A, IB { public string? MemberB { get; set; } }
class C : A, IC { public string? MemberC { get; set; } }

interface IA { public string? MemberA { get; } }
interface IB : IA { public string? MemberB { get; } }
interface IC : IA { public string? MemberC { get; } }
```

就可以这样序列化:

```cs
A a = new C() { MemberA = "abc", MemberC = "def" };
var json = JsonSerializer.Serialize(a, new JsonSerializerOptions()
{
    Converters = 
    {
        new AutoPolymorphicConverter<A>()
    }
});

Console.WriteLine(json);
```

以上代码输出:

```json
{"MemberC":"def","MemberA":"abc","SomePropertyOnlyInClass":"balabala","$type":"C"}
```

如果你想让它自动识别接口, 并仅序列化接口成员, 也可以这么做:

```cs
IA a2 = new C() { MemberA = "abc", MemberC = "def" };
var json2 = JsonSerializer.Serialize(a2, new JsonSerializerOptions()
{
    Converters =
    {
        new AutoPolymorphicConverter<IA>() { IsForInterface = true }
    }
});

Console.WriteLine(json2);
```

以上代码输出

```json
{"MemberC":"def","MemberA":"abc","$type":"IC"}
```

这个转换器处理的是声明类型和运行时类型不一致的问题.

正常情况下, 如果你用基类或接口变量保存派生类对象:

```cs
IA value = new C() { MemberA = "abc", MemberC = "def" };
```

`JsonSerializer.Serialize(value)` 只知道声明类型是 `IA`, 它没有理由自动把 `C` 或 `IC` 上的成员也写进去. 所以我们在序列化时主动做两件事:

1. 找到真正要序列化的类型, 对类来说是运行时类型, 对接口来说是最具体的接口
2. 把这个类型的完整名称写入 `$type`, 反序列化时再用这个名称找回类型

如果是接口多态, `IsForInterface = true` 会让转换器调用 `FindMaxInterface`, 从对象实现的接口中找到最具体的那个接口. 这样输出的是接口契约里的成员, 而不是实现类里所有公开属性. 这在跨进程插件场景很有用, 因为另一边通常只关心接口, 不应该依赖实现类细节.

实际项目中, 推荐这样配置:

```cs
var polymorphicConverter = new AutoPolymorphicConverter<IA>()
{
    IsForInterface = true
};
polymorphicConverter.TypeLookupAssemblies.Add(typeof(IA).Assembly);

var options = new JsonSerializerOptions()
{
    ReferenceHandler = new SingletonReferenceHandler(),
    WriteIndented = true,
    Converters =
    {
        polymorphicConverter
    }
};
```

如果序列化结果会跨进程或跨版本传输, 不建议直接暴露任意程序集中的任意类型. `TypeLookupAssemblies` 本质上就是一个白名单, 反序列化时只从这些程序集里查类型, 这样至少不会随便从所有已加载程序集里解析类型.

## 自动调用目标类型构造函数

如果你某个类型没有公开的构造函数, 还希望反序列化它, 可以使用 System.Text.Json 中自带的 `JsonConstructor` 特性.

但很遗憾, 这个功能貌似与 `ReferenceHandler` 不兼容. 所以我们需要自己写一个转换器, 用来自动调用带参数的构造函数.

```cs
public class CustomConstructorConverter : JsonConverter<object>
{
    private static ConstructorInfo? FindConstructor(Type type)
    {
        var constructors = type.GetConstructors();

        foreach (var constructor in constructors)
        {
            if (constructor.IsPublic &&
                constructor.GetParameters().Length == 0)
            {
                return null;
            }
        }

        foreach (var constructor in constructors)
        {
            if (constructor.GetCustomAttribute<JsonConstructorAttribute>() is not null)
            {
                return constructor;
            }
        }

        return null;
    }

    private static ParameterInfo? FindParameter(ParameterInfo[] parameters, string parameterName)
    {
        foreach (var parameter in parameters)
        {
            if (string.Equals(parameter.Name, parameterName, StringComparison.OrdinalIgnoreCase))
            {
                return parameter;
            }
        }

        return null;
    }

    public override bool CanConvert(Type typeToConvert)
        => FindConstructor(typeToConvert) != null;

    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new InvalidOperationException();
        }

        var jObj = JsonNode.Parse(ref reader) as JsonObject;
        if (jObj is null)
            return null;

        if (SingletonReferenceHandler.TryResolveReference(jObj, options, out var referenceValue))
        {
            return referenceValue;
        }

        var constructor = FindConstructor(typeToConvert)!;
        var constructorParameters = constructor.GetParameters();
        var parameterValues = new object?[constructorParameters.Length];
        foreach (var kv in jObj)
        {
            if (FindParameter(constructorParameters, kv.Key) is not { } parameter)
            {
                continue;
            }

            parameterValues[parameter.Position] = JsonSerializer.Deserialize(kv.Value, parameter.ParameterType, options);
        }

        var value = constructor.Invoke(parameterValues);
        SingletonReferenceHandler.AddReferenceIsNecessary(jObj, value, options);

        return value;
    }

    public override void Write(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
    {
        throw new NotSupportedException();
    }
}
```

此转换器只需要加入到解析 options 中的转换器, 就可以为所有没有无参构造的类型, 找到第一个公开构造函数, 并解析 JSON, 然后尝试构造.

值得一提的是, 构造函数的参数名称必须和属性名称一致, 大小写不敏感. 否则转换器无法为构造函数准备参数值.

例如:

```cs
public class UserInfo
{
    [JsonConstructor]
    public UserInfo(string name, int age)
    {
        Name = name;
        Age = age;
    }

    public string Name { get; }
    public int Age { get; }
}

var options = new JsonSerializerOptions()
{
    ReferenceHandler = new SingletonReferenceHandler(),
    Converters =
    {
        new CustomConstructorConverter()
    }
};

var user = JsonSerializer.Deserialize<UserInfo>(
    """{ "Name": "slime", "Age": 18 }""",
    options)!;

Console.WriteLine(user.Name);
```

它的原理是先把整个对象读成 `JsonObject`, 再根据构造函数参数名到 JSON 属性里找值. 找到之后, 对每个参数类型继续调用 `JsonSerializer.Deserialize`, 最后通过 `ConstructorInfo.Invoke` 创建对象.

为什么要先读成 `JsonObject`, 而不是直接一边读一边构造? 因为构造函数参数顺序不一定和 JSON 属性顺序一致. 先读成对象树之后, 就可以按属性名匹配参数, 不依赖 JSON 的字段顺序.

这个转换器只处理构造函数参数, 不会在构造之后继续给其它可写属性赋值. 如果你的类型既有构造函数参数, 又有额外可写属性, 需要继续补充一段属性赋值逻辑, 或者保持类型设计简单一点: 需要反序列化的成员都进入构造函数.

## 只读集合类型的数据成员填充

如果正常情况下你有一个集合是只读的, 并且你还希望反序列化的时候把成员填充进已有的集合中, 那么使用 `JsonObjectCreationHandling.Populate` 就可以做到.
但是很遗憾, 这个功能同样跟 `ReferenceHandler` 存在兼容问题, 所以又到了我们最喜欢的手搓 JsonConverter 时刻!

```cs
public class AutoPopulateMemberCollectionConverter<T> : JsonConverter<T>
{
    private static void PopulateChildrenIntoCollection(
        object? targetObject,
        JsonArray children,
        JsonSerializerOptions options)
    {
        if (targetObject is null)
            throw new InvalidOperationException("The collection value to populate is null.");

        var targetType = targetObject.GetType();

        // Array / T[]
        if (targetObject is Array array)
        {
            var itemType = targetType.GetElementType()
                ?? throw new InvalidOperationException("Can not determine array element type.");

            if (array.Length < children.Count)
                throw new InvalidOperationException("Array length is insufficient to populate all child elements.");

            for (var i = 0; i < children.Count; i++)
            {
                var value = JsonSerializer.Deserialize(children[i], itemType, options);
                array.SetValue(value, i);
            }

            return;
        }

        // IList<T>
        var collectionInterface = targetType
            .GetInterfaces()
            .Concat(new[] { targetType })
            .FirstOrDefault(t =>
                t.IsGenericType &&
                t.GetGenericTypeDefinition() == typeof(ICollection<>));

        if (collectionInterface is not null)
        {
            var itemType = collectionInterface.GetGenericArguments()[0];

            var isReadOnlyProperty = collectionInterface.GetProperty("IsReadOnly");
            if (isReadOnlyProperty?.GetValue(targetObject) is true)
                throw new InvalidOperationException("The collection to populate is not writable.");

            var addMethod = collectionInterface.GetMethod("Add")
                ?? throw new InvalidOperationException("The collection to populate is not writable.");

            foreach (var item in children)
            {
                var value = JsonSerializer.Deserialize(item, itemType, options);
                addMethod.Invoke(targetObject, new[] { value });
            }

            return;
        }

        // non-generic IList
        if (targetObject is IList list)
        {
            if (list.IsReadOnly || list.IsFixedSize)
                throw new InvalidOperationException("The collection to populate is not writable.");

            foreach (var item in children)
            {
                var value = JsonSerializer.Deserialize<object>(item, options);
                list.Add(value);
            }

            return;
        }

        throw new InvalidOperationException("The object to populate is not a writable collection.");
    }

    public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return default;
        }

        var node = JsonNode.Parse(ref reader);

        if (node is not JsonObject payload)
        {
            throw new JsonException($"Expected JSON object for interface type '{typeToConvert}'.");
        }

        if (SingletonReferenceHandler.TryResolveReference(payload, options, out var referenceValue))
        {
            return (T?)referenceValue;
        }

        var subOptions = new JsonSerializerOptions(options);
        subOptions.Converters.Remove(this);

        var value = (T?)JsonSerializer.Deserialize(payload, typeToConvert, subOptions);

        if (value is { })
        {
            var actualType = value.GetType();
            foreach (var property in actualType.GetProperties())
            {
                if (property.CanWrite ||
                    !payload.TryGetPropertyValue(property.Name, out var propertyValueNode) ||
                    propertyValueNode is null)
                {
                    continue;
                }

                if (propertyValueNode.GetValueKind() == JsonValueKind.Array ||
                    (propertyValueNode.GetValueKind() == JsonValueKind.Object &&
                    propertyValueNode.AsObject().TryGetPropertyValue("$values", out propertyValueNode) &&
                    propertyValueNode is JsonArray))
                {
                    var collection = property.GetValue(value);
                    PopulateChildrenIntoCollection(collection, (JsonArray)propertyValueNode, options);
                }
            }
        }

        return value;
    }

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
    {
        options.Converters.Remove(this);
        JsonSerializer.Serialize(writer, value, options);
        options.Converters.Add(this);
    }
}
```

使用的时候, 假如你有一个类型 `A`, 它有一个只读的集合属性, 例如 `public List<int> SomeCollection { get; } = new();`,
那么在反序列化的时候, 在 `Converters` 列表最前方添加一个 `AutoPopulateMemberCollectionConverter<A>` 就可以了.

如果放到后面, 类型实例化可能会优先被其他转换器执行, 导致无法自动填充成员. 此转换器会自动使用后续转换器来转换, 得出值之后, 再进行填充.

使用示例:

```cs
public class Menu
{
    public string Name { get; set; } = "";
    public List<MenuItem> Items { get; } = new();
}

public class MenuItem
{
    public string Text { get; set; } = "";
}

var options = new JsonSerializerOptions()
{
    ReferenceHandler = new SingletonReferenceHandler(),
    Converters =
    {
        new AutoPopulateMemberCollectionConverter<Menu>()
    }
};

var menu = JsonSerializer.Deserialize<Menu>(
    """
    {
      "Name": "File",
      "Items": [
        { "Text": "Open" },
        { "Text": "Save" }
      ]
    }
    """,
    options)!;

Console.WriteLine(menu.Items.Count); // 2
```

这个转换器分成两步:

1. 先临时移除自己, 让 `System.Text.Json` 用默认逻辑把对象主体创建出来
2. 再检查对象的只读集合属性, 如果 JSON 中有对应数组, 就把数组中的元素逐个反序列化并添加到已有集合里

也就是说, 它不是替代整个对象的反序列化流程, 而是在默认流程之后补一刀. 这样它可以少管很多事情, 例如普通属性赋值, 构造函数选择, 数字字符串转换等都交给原本的序列化器处理.

## 将所有转换器组合起来

上面这些转换器并不是都能同时用于序列化和反序列化.

例如:

- `InterfaceProxyConverter` 只支持读, 它的作用是反序列化接口代理, `Write` 直接抛出 `NotSupportedException`
- `CustomConstructorConverter` 只支持读, 它的作用是调用目标类型的构造函数, `Write` 也直接抛出 `NotSupportedException`
- `AutoPopulateMemberCollectionConverter<T>` 主要解决读的时候填充只读集合
- `CommonParseConverter` 读写都支持
- `AutoPolymorphicConverter<T>` 读写都支持, 但序列化时主要负责写入 `$type`, 反序列化时还需要通过 `TypeLookupAssemblies` 找回类型

所以实际使用时, 不应该强行把所有转换器都丢到同一个 `JsonSerializerOptions` 里. 更合理的方式是准备两套 Options:

1. 一套用于序列化, 只放写入阶段需要的转换器
2. 一套用于反序列化, 只放读取阶段需要的转换器

假设有这样的模型:

```cs
public class A : IA
{
    public string? MemberA { get; set; }
    public IA? Other { get; set; }
    public string? SomePropertyOnlyInClass { get; set; }
    public List<int> SomeCollection { get; } = new();
    public CustomContructorClass? CCCValue { get; set; }
    public Int2 Vector { get; set; }
}

public class B : A, IB
{
    public string? MemberB { get; set; }
}

public class C : A, IC
{
    public string? MemberC { get; set; }
}

public class CustomContructorClass
{
    public CustomContructorClass(string a, string b)
    {
        A = a;
        B = b;
    }

    public string A { get; }
    public string B { get; }
}

public record struct Int2(int X, int Y)
{
    public static Int2 Parse(string s)
    {
        var parts = s.Split(',');
        return new Int2(int.Parse(parts[0]), int.Parse(parts[1]));
    }

    public override string ToString()
        => $"{X},{Y}";
}

public interface IA
{
    string? MemberA { get; set; }
    IA? Other { get; set; }
}

public interface IB : IA
{
    string? MemberB { get; set; }
}

public interface IC : IA
{
    string? MemberC { get; set; }
}
```

再创建一份带循环引用的对象:

```cs
A complexObject = new C()
{
    MemberA = "ValueA",
    SomePropertyOnlyInClass = "QWQ",
    SomeCollection =
    {
        1, 2, 3, 4, 5
    },
    CCCValue = new CustomContructorClass("A", "B"),
    Vector = new Int2(10, 20)
};

B complexObject2 = new B()
{
    MemberA = "ValueA",
    MemberB = "ValueB",
    SomePropertyOnlyInClass = "AWA",
    SomeCollection =
    {
        7, 8, 9, 10
    }
};

complexObject.Other = complexObject2;
complexObject2.Other = complexObject;
```

然后准备同一个 `SingletonReferenceHandler`, 以及两套 Options:

```cs
var singletonReferenceHandler = new SingletonReferenceHandler();

var serializeOptions = new JsonSerializerOptions()
{
    WriteIndented = true,
    ReferenceHandler = singletonReferenceHandler,
    Converters =
    {
        new CommonParseConverter(),
        new AutoPolymorphicConverter<A>(),
        new AutoPolymorphicConverter<IA>() { IsForInterface = true },
    }
};

var deserializeOptions = new JsonSerializerOptions()
{
    ReferenceHandler = singletonReferenceHandler,
    Converters =
    {
        new AutoPopulateMemberCollectionConverter<A>(),
        new CommonParseConverter(),
        new AutoPolymorphicConverter<A>()
        {
            TypeLookupAssemblies = { typeof(A).Assembly }
        },
        new AutoPolymorphicConverter<IA>()
        {
            IsForInterface = true,
            TypeLookupAssemblies = { typeof(A).Assembly }
        },
        new InterfaceProxyConverter()
        {
            TypesToProxy = { typeof(IA) },
            TypeLookupAssemblies = { typeof(A).Assembly }
        },
        new CustomConstructorConverter(),
    }
};
```

这里最关键的是: 序列化和反序列化都使用同一个 `SingletonReferenceHandler`, 但每次开始一次新的操作前都要 `Reset`.

```cs
singletonReferenceHandler.Reset();
var json = JsonSerializer.Serialize(complexObject, serializeOptions);

singletonReferenceHandler.Reset();
var deserializedObject = JsonSerializer.Deserialize<A>(json, deserializeOptions);

singletonReferenceHandler.Reset();
var json2 = JsonSerializer.Serialize(deserializedObject, serializeOptions);
```

第一次序列化可能得到这样的 JSON:

```json
{
  "$id": "1",
  "MemberC": null,
  "MemberA": "ValueA",
  "Other": {
    "$id": "2",
    "MemberB": "ValueB",
    "MemberA": "ValueA",
    "Other": {
      "$ref": "1",
      "$type": "AdvancedJsonSerialization.IC"
    },
    "$type": "AdvancedJsonSerialization.IB"
  },
  "SomePropertyOnlyInClass": "QWQ",
  "SomeCollection": {
    "$id": "3",
    "$values": [
      1,
      2,
      3,
      4,
      5
    ]
  },
  "CCCValue": {
    "$id": "4",
    "A": "A",
    "B": "B"
  },
  "Vector": "10,20",
  "$type": "AdvancedJsonSerialization.C"
}
```

这个 JSON 中同时包含了几个关键信息:

1. `$id` 和 `$ref` 保存了对象引用关系
2. `$type` 保存了运行时类型或更具体的接口类型
3. `SomeCollection` 使用 `$values` 保存集合内容
4. `CCCValue` 虽然没有无参构造函数, 但 JSON 中保留了构造函数所需的属性
5. `Vector` 被写成字符串, 反序列化时通过 `Int2.Parse` 读回

如果反序列化之后再使用同一套 `serializeOptions` 序列化一次, 得到的 JSON 应当和前面基本一致. 这就说明循环引用, 多态类型, 接口代理, 构造函数对象, 只读集合和 `Parse` 类型都被正确还原了.

## 两套 Options 的转换器顺序

序列化 Options 的顺序比较简单:

```cs
Converters =
{
    new CommonParseConverter(),
    new AutoPolymorphicConverter<A>(),
    new AutoPolymorphicConverter<IA>() { IsForInterface = true },
}
```

`CommonParseConverter` 负责把 `Int2` 这类类型写成字符串. `AutoPolymorphicConverter<A>` 负责类多态, 也就是把实际的 `C` 写出来. `AutoPolymorphicConverter<IA>` 负责接口多态, 也就是当成员声明为 `IA` 但实际对象实现了 `IB` 或 `IC` 时, 写入更具体的接口类型.

反序列化 Options 的顺序更重要:

```cs
Converters =
{
    new AutoPopulateMemberCollectionConverter<A>(),
    new CommonParseConverter(),
    new AutoPolymorphicConverter<A>()
    {
        TypeLookupAssemblies = { typeof(A).Assembly }
    },
    new AutoPolymorphicConverter<IA>()
    {
        IsForInterface = true,
        TypeLookupAssemblies = { typeof(A).Assembly }
    },
    new InterfaceProxyConverter()
    {
        TypesToProxy = { typeof(IA) },
        TypeLookupAssemblies = { typeof(A).Assembly }
    },
    new CustomConstructorConverter(),
}
```

`AutoPopulateMemberCollectionConverter<A>` 要放在前面, 因为它需要包住 `A` 的默认反序列化流程, 等对象创建完成后再填充只读集合.

`CommonParseConverter` 需要在遇到 `Int2` 这种字符串值类型时接管读取.

两个 `AutoPolymorphicConverter` 分别处理类和接口上的 `$type`. 读侧一定要设置 `TypeLookupAssemblies`, 否则它只读到了类型名称, 但不知道应该去哪一个程序集里找这个类型.

`InterfaceProxyConverter` 放在多态转换器后面, 用来真正创建接口代理. 它同样需要 `TypesToProxy` 和 `TypeLookupAssemblies`: 前者限制哪些接口可以代理, 后者用于根据 `$type` 找到更具体的接口类型.

`CustomConstructorConverter` 放在后面兜底处理没有无参构造函数的类型. 在上面的例子里, `CustomContructorClass` 就是通过它还原的.

## 局限和注意事项

这套方案的重点是保存和恢复复杂对象图, 不是替代所有 DTO.

首先, 要分清楚哪些转换器能写, 哪些转换器能读. 如果把 `InterfaceProxyConverter` 或 `CustomConstructorConverter` 放进序列化 Options, 并且刚好命中它们的 `CanConvert`, 就会因为 `Write` 抛出 `NotSupportedException` 而失败.

其次, `TypeLookupAssemblies` 不只是为了让代码能跑, 它也相当于类型解析范围的限制. 不要对外部不可信 JSON 开放任意类型解析. 如果 JSON 来自不可信来源, 最好在程序集限制之外再做一层类型白名单.

另外, `SingletonReferenceHandler` 不是全局缓存. 它只是为了让一次序列化或反序列化流程中的多次 `JsonSerializer` 调用共享同一个引用解析器. 每次开始新的序列化或反序列化前都应该调用 `Reset`, 或者直接为每次操作创建新的 Handler 和 Options.

最后, 动态代理只适合这种“属性接口”模型. 如果接口里有普通方法, 当前 `InterfaceInterceptor` 并不会处理方法调用. 真要跨进程调用方法, 应该额外设计 RPC 或消息协议, 不应该指望 JSON 反序列化自动解决方法执行.
